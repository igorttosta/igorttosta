// Gera os cards de estatísticas do perfil (SVG) usando apenas a API GraphQL do GitHub.
// Sem dependências externas: roda com o Node puro do runner do GitHub Actions.
//
// Uso: GITHUB_TOKEN=... GITHUB_USER=igorttosta node generate-stats.mjs <pasta-de-saida>

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    pullRequests { totalCount }
    issues { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
    contributionsCollection {
      totalCommitContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}`;

const THEMES = {
  light: { bg: "#ffffff", border: "#d0d7de", title: "#0969da", text: "#1f2328", muted: "#59636e", track: "#eaeef2" },
  dark: { bg: "#0d1117", border: "#30363d", title: "#4493f8", text: "#e6edf3", muted: "#9198a1", track: "#21262d" },
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const WIDTH = 495;
const TOP_LANGUAGES = 6;
// Os dois cards ficam lado a lado no README, então usam a mesma altura.
const HEIGHT = 236;

async function fetchUser(login, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": login },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub API respondeu ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Erro na consulta GraphQL: ${JSON.stringify(json.errors)}`);
  if (!json.data?.user) throw new Error(`Usuário "${login}" não encontrado`);
  return json.data.user;
}

function computeStreaks(days) {
  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = day.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // O dia de hoje ainda pode receber contribuições: se está zerado, não quebra a sequência.
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].contributionCount > 0) {
    current++;
    i--;
  }
  return { current, longest };
}

export function summarize(user) {
  const calendar = user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap((w) => w.contributionDays);
  const repos = user.repositories.nodes;

  const languageSizes = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      const current = languageSizes.get(node.name) ?? { size: 0, color: node.color ?? "#8b949e" };
      current.size += size;
      languageSizes.set(node.name, current);
    }
  }
  const totalSize = [...languageSizes.values()].reduce((sum, l) => sum + l.size, 0) || 1;
  const languages = [...languageSizes.entries()]
    .map(([name, { size, color }]) => ({ name, color, percent: (size / totalSize) * 100 }))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, TOP_LANGUAGES);

  return {
    contributions: calendar.totalContributions,
    commits: user.contributionsCollection.totalCommitContributions,
    pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    stars: repos.reduce((sum, r) => sum + r.stargazerCount, 0),
    repositories: user.repositories.totalCount,
    streak: computeStreaks(days),
    languages,
  };
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const format = (n) => n.toLocaleString("pt-BR");
const days = (n) => `${format(n)} ${n === 1 ? "dia" : "dias"}`;

function card(theme, title, body) {
  const height = HEIGHT;
  const t = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escape(title)}">
  <title>${escape(title)}</title>
  <rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>
  <text x="25" y="38" font-family="${FONT}" font-size="18" font-weight="600" fill="${t.title}">${escape(title)}</text>
${body(t)}
</svg>
`;
}

export function renderStats(stats, theme) {
  const items = [
    ["Contribuições (12 meses)", format(stats.contributions)],
    ["Commits (12 meses)", format(stats.commits)],
    ["Pull requests", format(stats.pullRequests)],
    ["Issues", format(stats.issues)],
    ["Repositórios", format(stats.repositories)],
    ["Estrelas recebidas", format(stats.stars)],
    ["Sequência atual", days(stats.streak.current)],
    ["Maior sequência (12 meses)", days(stats.streak.longest)],
  ];
  return card(theme, "Estatísticas no GitHub", (t) =>
    items
      .map(([label, value], i) => {
        const x = i % 2 === 0 ? 25 : 260;
        const y = 74 + Math.floor(i / 2) * 42;
        return `  <text x="${x}" y="${y}" font-family="${FONT}" font-size="12" fill="${t.muted}">${escape(label)}</text>
  <text x="${x}" y="${y + 17}" font-family="${FONT}" font-size="15" font-weight="600" fill="${t.text}">${escape(value)}</text>`;
      })
      .join("\n"),
  );
}

export function renderLanguages(stats, theme) {
  const barWidth = WIDTH - 50;
  return card(theme, "Linguagens mais usadas", (t) => {
    let offset = 0;
    const segments = stats.languages
      .map((l) => {
        const w = (l.percent / 100) * barWidth;
        const rect = `    <rect x="${(25 + offset).toFixed(2)}" y="60" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
        offset += w;
        return rect;
      })
      .join("\n");
    const legend = stats.languages
      .map((l, i) => {
        const x = i % 2 === 0 ? 25 : 260;
        const y = 106 + Math.floor(i / 2) * 40;
        return `  <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>
  <text x="${x + 16}" y="${y}" font-family="${FONT}" font-size="13" fill="${t.text}">${escape(l.name)} <tspan fill="${t.muted}">${l.percent.toFixed(1).replace(".", ",")}%</tspan></text>`;
      })
      .join("\n");
    return `  <clipPath id="bar"><rect x="25" y="60" width="${barWidth}" height="8" rx="4"/></clipPath>
  <rect x="25" y="60" width="${barWidth}" height="8" rx="4" fill="${t.track}"/>
  <g clip-path="url(#bar)">
${segments}
  </g>
${legend}`;
  });
}

async function main() {
  const outDir = process.argv[2] ?? "dist";
  const token = process.env.GITHUB_TOKEN;
  const login = process.env.GITHUB_USER;
  if (!token || !login) throw new Error("Defina GITHUB_TOKEN e GITHUB_USER");

  const stats = summarize(await fetchUser(login, token));
  await mkdir(outDir, { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    const suffix = theme === "dark" ? "-dark" : "";
    await writeFile(join(outDir, `stats${suffix}.svg`), renderStats(stats, theme));
    await writeFile(join(outDir, `languages${suffix}.svg`), renderLanguages(stats, theme));
  }
  console.log(`Estatísticas geradas em ${outDir}:`, JSON.stringify({ ...stats, languages: stats.languages.map((l) => l.name) }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
