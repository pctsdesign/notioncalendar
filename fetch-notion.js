// fetch-notion.js — roda pelo GitHub Actions, sem CORS
// Busca 4 meses de dados (2 passados + 2 futuros) e salva em data.json

const https = require('https');
const fs = require('fs');

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('NOTION_TOKEN não definido'); process.exit(1); }

const NV = '2022-06-28';

// IDs de usuário no Notion (confirmados via workspace)
const PAT_ID = '9803a758-bc90-43b3-b6e0-f958307d1461';
const JECKSON_ID = '3cad872b-594c-81be-afb9-0002dc0ee28b';
const NATALIA_ID = 'f09dd7e8-67ce-4b92-a8ab-614d2c68b129';

const DATABASES = [
  // ── Clientes principais ────────────────────────────────────────
  { id: '19482cfc4f0a81bb9190fd33c430d1d8', name: 'eko',           bg: '#d3e5ef', fg: '#2e7dc7', df: 'Postar em', tf: 'Atividade/Post', sf: 'Andamento', pf: 'Responsável' },
  { id: '47a82cfc4f0a8388ac5281849c62cf04', name: 'jocil',               bg: '#dbeddb', fg: '#448361', df: 'Postar em',       tf: 'Pauta',          sf: 'Status',    pf: 'Responsável' },
  { id: '27d82cfc4f0a818a92f0d3670f743d6f', name: 'ppg',bg: '#fadec9', fg: '#c47615', df: 'Postar em',       tf: 'Pauta',          sf: 'Status',    pf: 'Responsável no momento' },
  { id: '19482cfc4f0a8054b79bd137dfdc8dda', name: 'movelaria',           bg: '#e8deee', fg: '#9065b0', df: 'Postar em',       tf: 'Pauta',          sf: 'Status',    pf: 'Responsável' },
  { id: '2bf82cfc4f0a81ddb9afdfcc90f54f8f', name: 'amelis',         bg: '#f5e0e9', fg: '#c04274', df: 'Postar em', tf: 'Pauta',          sf: 'Status',    pf: 'Responsável' },

  // ── Clientes adicionais ────────────────────────────────────────
  {
    id: '3cb82cfc4f0a8054a9d9f443b8642c25',
    name: 'ch representações',
    bg: '#fdecc8', fg: '#8a4e00',
    df: 'Data de entrega', tf: 'Pauta', sf: 'Status', pf: 'Responsável'
  },
  {
    id: 'c15d158586754fd7af71071ef04711d5',
    name: 'oito sais',
    bg: '#ffe2dd', fg: '#a12e2e',
    df: 'Data de Entrega', tf: 'Atividade/Post', sf: 'Andamento', pf: 'Responsável no momento',
    // Filtra só tarefas do cliente Oito Sais nesse banco compartilhado
    extraFilter: { property: 'Cliente', select: { equals: 'Oito Sais' } }
  },
  {
    id: '8fb18bcaaa2d413b8028c7e904493444',
    name: 'yure silva',
    bg: '#e3e2e0', fg: '#444',
    df: 'Data de Entrega', tf: 'Atividade/Post', sf: 'Andamento', pf: 'Responsável no momento'
  },
];

const DONE = ['concluido','concluído','entregue','finalizado','feito','aprovado','fail','evento','done','complete','pronto'];
function isDone(s) { return s ? DONE.some(d => s.toLowerCase().includes(d)) : false; }

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function notionRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.notion.com',
      path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Notion-Version': NV,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${raw.substring(0,120)}`));
        resolve(JSON.parse(raw));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchDB(db, start, end) {
  // Build filter: date range + optional extra filter (e.g. Cliente = X)
  const dateFilter = {
    and: [
      { property: db.df, date: { on_or_after: start } },
      { property: db.df, date: { before: end } }
    ]
  };

  const filter = db.extraFilter
    ? { and: [dateFilter, db.extraFilter] }
    : dateFilter;

  const body = { filter, page_size: 100 };
  let cursor, all = [];
  do {
    if (cursor) body.start_cursor = cursor;
    const j = await notionRequest(`/v1/databases/${db.id}/query`, body);
    all = all.concat(j.results || []);
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);

  return all.map(p => {
    const pr = p.properties;
    let statusName = '', formatoName = '';
    for (const [k, v] of Object.entries(pr)) {
      if (!v) continue;
      const n = v?.status?.name || v?.select?.name || '';
      if (!n) continue;
      if (k === db.sf || k === 'Andamento') statusName = n;
      if (k === 'Formato') formatoName = n;
    }
    const anyEvento = Object.values(pr).some(v => {
      const n = v?.status?.name || v?.select?.name || '';
      return n.toLowerCase() === 'evento';
    });
    const done = isDone(statusName) || isDone(formatoName) || anyEvento;
    const date = pr[db.df]?.date?.start?.substring(0, 10) || null;
    const title = pr[db.tf]?.title?.[0]?.plain_text || '(sem título)';
    const url = `https://notion.so/${p.id.replace(/-/g, '')}`;
    const people = (db.pf && pr[db.pf]?.people ? pr[db.pf].people.map(u => u.id) : []);
    return { date, title, url, bg: db.bg, fg: db.fg, name: db.name, done, people };
  }).filter(e => e.date);
}

async function main() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 4, 1);
  const startISO = iso(start);
  const endISO   = iso(end);

  console.log(`Buscando de ${startISO} a ${endISO}...\n`);

  const events = [];
  for (const db of DATABASES) {
    try {
      const items = await fetchDB(db, startISO, endISO);
      events.push(...items);
      console.log(`✓ ${db.name}: ${items.length} eventos`);
    } catch (e) {
      console.error(`✗ ${db.name}:`, e.message);
    }
  }

  const output = { updated: new Date().toISOString(), events: events.map(({ people, ...rest }) => rest) };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`\n✅ data.json salvo com ${events.length} eventos totais.`);

  // ── Arquivos por pessoa (mesmos dados, filtrados por Responsável) ──
  const strip = e => { const { people, ...rest } = e; return rest; };
  const pat = { updated: output.updated, events: events.filter(e => e.people.includes(PAT_ID)).map(strip) };
  const jeckson = { updated: output.updated, events: events.filter(e => e.people.includes(JECKSON_ID)).map(strip) };
  const natalia = { updated: output.updated, events: events.filter(e => e.people.includes(NATALIA_ID)).map(strip) };
  fs.writeFileSync('data-pat.json', JSON.stringify(pat, null, 2));
  fs.writeFileSync('data-jeckson.json', JSON.stringify(jeckson, null, 2));
  fs.writeFileSync('data-natalia.json', JSON.stringify(natalia, null, 2));
  console.log(`✅ data-pat.json salvo com ${pat.events.length} eventos.`);
  console.log(`✅ data-jeckson.json salvo com ${jeckson.events.length} eventos.`);
  console.log(`✅ data-natalia.json salvo com ${natalia.events.length} eventos.`);
}

main().catch(e => { console.error(e); process.exit(1); });
