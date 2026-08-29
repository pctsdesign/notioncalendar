// fetch-notion.js — roda pelo GitHub Actions, sem CORS
// Busca 4 meses de dados (2 passados + 2 futuros) e salva em data.json

const https = require('https');
const fs = require('fs');

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('NOTION_TOKEN não definido'); process.exit(1); }

const NV = '2022-06-28';

const DATABASES = [
  { id: '19482cfc4f0a81bb9190fd33c430d1d8', name: 'eko natal',           bg: '#d3e5ef', fg: '#2e7dc7', df: 'Data de Entrega', tf: 'Atividade/Post', sf: 'Andamento' },
  { id: '47a82cfc4f0a8388ac5281849c62cf04', name: 'jocil',               bg: '#dbeddb', fg: '#448361', df: 'Postar em',       tf: 'Pauta',          sf: 'Status'    },
  { id: '27d82cfc4f0a818a92f0d3670f743d6f', name: 'pousada pedra grande',bg: '#fadec9', fg: '#c47615', df: 'Postar em',       tf: 'Pauta',          sf: 'Status'    },
  { id: '19482cfc4f0a8054b79bd137dfdc8dda', name: 'movelaria',           bg: '#e8deee', fg: '#9065b0', df: 'Postar em',       tf: 'Pauta',          sf: 'Status'    },
  { id: '2bf82cfc4f0a81ddb9afdfcc90f54f8f', name: 'casa amelis',         bg: '#f5e0e9', fg: '#c04274', df: 'Data de entrega', tf: 'Pauta',          sf: 'Status'    },
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
  const body = {
    filter: { and: [
      { property: db.df, date: { on_or_after: start } },
      { property: db.df, date: { before: end } }
    ]},
    page_size: 100
  };
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
    return { date, title, url, bg: db.bg, fg: db.fg, name: db.name, done };
  }).filter(e => e.date);
}

async function main() {
  const now = new Date();
  // 2 meses atrás até 3 meses à frente
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 4, 1);
  const startISO = iso(start);
  const endISO   = iso(end);

  console.log(`Buscando de ${startISO} a ${endISO}...`);

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

  const output = { updated: new Date().toISOString(), events };
  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`\n✅ data.json salvo com ${events.length} eventos totais.`);
}

main().catch(e => { console.error(e); process.exit(1); });
