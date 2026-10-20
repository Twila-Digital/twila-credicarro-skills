#!/usr/bin/env node
// Gera os arquivos únicos para ferramentas de IA que só carregam um arquivo de skill:
// - SKILL-CONSOLIDATED.md: rules/, examples/, tools/ e utils/ concatenados.
// - SKILL-AGENT.md: só o Agent Mode (rules/agent.md + rules/proposal-steps.md).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const LANGUAGES = [
  ["dotnet", ".NET"],
  ["java", "Java"],
  ["node", "Node.js"],
  ["python", "Python"],
  ["php", "PHP"],
  ["go", "Go"],
];
const MODULES = ["client", "customers", "simulations", "proposals", "webhooks", "security"];
const EXAMPLE_EXT = { dotnet: "cs", java: "java", node: "ts", python: "py", php: "php", go: "go" };
const FENCE_LANG = { dotnet: "csharp", java: "java", node: "ts", python: "python", php: "php", go: "go" };
const MODULE_TITLES = {
  client: "Client",
  customers: "Customers",
  simulations: "Simulations",
  proposals: "Proposals",
  webhooks: "Webhooks",
  security: "Security",
};

const STEPS_TITLE = "Regras: Etapas e status da proposta";
const STEPS_ANCHOR = "#regras-etapas-e-status-da-proposta";

function read(path) {
  return readFileSync(join(root, path), "utf8").split("\r\n").join("\n").trimEnd();
}

function splitTitle(content) {
  const match = content.match(/^# (.+)\n/);

  return match
    ? { title: match[1].trim(), body: content.slice(match[0].length) }
    : { title: null, body: content };
}

function stripTitle(content) {
  return content.replace(/^# .+\n/, "");
}

function stripFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

function demoteHeadings(content, levels = 2) {
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^(#{1,4})\s/, (_, hashes) => "#".repeat(hashes.length + levels) + " ");
    })
    .join("\n");
}

// No arquivo único, os links para a regra compartilhada apontam para a seção dela; os demais links
// relativos viram texto, porque o arquivo de destino não existe para quem carrega só o arquivo único.
function rewriteLinks(content) {
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line
        .replace(/\]\((?:\.\.\/)*(?:rules\/)?proposal-steps\.md(?:#[a-z0-9-]+)?\)/g, `](${STEPS_ANCHOR})`)
        .replace(/\[([^\]]+)\]\((?!https?:|mailto:|#)[^)\s]+\)/g, "$1");
    })
    .join("\n");
}

function frontmatter(name, description) {
  return `---
name: ${name}
description: ${description}
metadata:
  tags: credicarro, financiamento, refinanciamento, veiculos, credito, proposta, simulacao, webhooks, api
---`;
}

function write(file, parts) {
  const output = rewriteLinks(parts.join("\n\n") + "\n");
  writeFileSync(join(root, file), output);
  console.log(`${file} gerado (${output.length} bytes).`);
}

const stepsSection = `---\n\n## ${STEPS_TITLE}\n\n` + demoteHeadings(stripTitle(read("rules/proposal-steps.md")));
const agentSection = "---\n\n## Regras: Agent Mode — Uso direto da API\n\n" + demoteHeadings(stripTitle(read("rules/agent.md")));

// SKILL-CONSOLIDATED.md
const consolidated = [];

consolidated.push(frontmatter(
  "credicarro-consolidated",
  "Standalone consolidated skill for the Credicarro vehicle credit API — all rules, examples, tools and utilities inlined in a single file. No external references needed.",
));

consolidated.push(stripFrontmatter(read("SKILL.md")).split("## Índice de arquivos")[0].trim());
consolidated.push(stepsSection);
consolidated.push(agentSection);

for (const [dir, label] of LANGUAGES) {
  let section = `---\n\n## Regras: ${label}\n`;
  for (const mod of MODULES) {
    const path = `rules/${dir}/${mod}.md`;
    if (!existsSync(join(root, path))) continue;
    section += `\n### ${MODULE_TITLES[mod]}\n` + demoteHeadings(stripTitle(read(path)), 1);
  }
  consolidated.push(section.trim());
}

for (const [dir, label] of LANGUAGES) {
  let section = `---\n\n## Exemplos: ${label}\n`;
  for (const mod of MODULES) {
    const path = `examples/${dir}/${mod}.${EXAMPLE_EXT[dir]}`;
    if (!existsSync(join(root, path))) continue;
    section += `\n### ${MODULE_TITLES[mod]}\n\`\`\`${FENCE_LANG[dir]}\n${read(path)}\n\`\`\`\n`;
  }
  consolidated.push(section.trim());
}

let tools = "---\n\n## Ferramentas\n";
for (const f of ["auth", "environments", "production", "ecosystem"]) {
  const { title, body } = splitTitle(read(`tools/${f}.md`));
  tools += `\n### ${title}\n` + demoteHeadings(body, 2);
}
tools += "\n### SDKs\n";
for (const [dir] of LANGUAGES) {
  const path = `tools/sdks/${dir}.md`;
  if (!existsSync(join(root, path))) continue;
  const { title, body } = splitTitle(read(path));
  tools += `\n#### ${title}\n` + demoteHeadings(body, 3);
}
consolidated.push(tools.trim());

let utils = "---\n\n## Utilitários\n";
for (const f of ["faq", "glossary"]) {
  const { title, body } = splitTitle(read(`utils/${f}.md`));
  utils += `\n### ${title}\n` + demoteHeadings(body, 2);
}
consolidated.push(utils.trim());

const skillVisual = read("SKILL.md").split("## Documentação visual")[1];
if (skillVisual) {
  consolidated.push("---\n\n## Documentação visual\n" + skillVisual.trim());
}

write("SKILL-CONSOLIDATED.md", consolidated);

// SKILL-AGENT.md
write("SKILL-AGENT.md", [
  frontmatter(
    "credicarro-agent",
    "Standalone skill for calling the Credicarro vehicle credit API directly via curl — access token, customers, simulations, proposals and their steps, documents, vehicle details, deposit account and webhooks. Agent mode only, no integration code.",
  ),
  "## Quando usar\n\nQuando o usuário quer **executar ações** diretamente — gerar token, cadastrar cliente, consultar faixa, simular, criar ou consultar proposta, enviar documento, dados do veículo ou conta de recebimento, cadastrar ou editar webhook. Chame a API do Credicarro via `curl` no terminal. Para escrever código de integração, use a skill completa (`SKILL.md`).",
  agentSection,
  stepsSection,
]);
