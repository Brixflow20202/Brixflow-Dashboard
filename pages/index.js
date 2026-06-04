import { useState, useEffect } from 'react';
import Head from 'next/head';

const SECTORS = ['Restaurants','Hotels','Automotive','Zorg','Home services','Property','Koffietentjes','Kappers','Sportscholen','Winkels'];
const MINLOC  = ['1+','2+','5+','10+','25+'];
const REVIEWS = ['Geen voorkeur','50+ reviews','200+ reviews','500+ reviews','1000+ reviews'];
const ACTIVITY= ['Geen voorkeur','1+ per maand','3+ per maand','10+ per maand','20+ per maand'];
const RESPONSE= ['Geen voorkeur','Reageert niet / nauwelijks','Reageert traag (>1 week)','Reageert inconsistent','Reageert al goed'];
const MARKETS = ['Nederland','Europa','DACH'];
const STATUS_OPTIONS = ['Nieuw','Contacted','Gekwalificeerd','Afgewezen'];
const STATUS_COLORS  = { 'Nieuw':'#7c6aff','Contacted':'#f5a623','Gekwalificeerd':'#3ecf8e','Afgewezen':'#ff5c5c' };

export default function Home() {
  const [tab, setTab]           = useState('search'); // search | dashboard
  const [mode, setMode]         = useState('guided'); // guided | free
  const [sectors, setSectors]   = useState(['Restaurants','Hotels']);
  const [minloc, setMinloc]     = useState('1+');
  const [reviews, setReviews]   = useState('50+ reviews');
  const [activity, setActivity] = useState('3+ per maand');
  const [response, setResponse] = useState('Reageert niet / nauwelijks');
  const [market, setMarket]     = useState('Nederland');
  const [keyword, setKeyword]   = useState('');
  const [freeText, setFreeText] = useState('');
  const [apiKey, setApiKey]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [statusMsg, setStatus]  = useState('Klaar om te zoeken');
  const [statusType, setStatusType] = useState('idle'); // idle | active | done | error
  const [results, setResults]   = useState([]);
  const [saved, setSaved]       = useState([]);
  const [activeNote, setActiveNote] = useState(null); // lead index in saved
  const [noteText, setNoteText] = useState('');
  const [searchHistory, setSearchHistory] = useState([]);

  // Load saved from localStorage
  useEffect(() => {
    try {
      const s = localStorage.getItem('brixflow_leads');
      if (s) setSaved(JSON.parse(s));
      const k = localStorage.getItem('brixflow_key');
      if (k) setApiKey(k);
    } catch(e) {}
  }, []);

  const persistSaved = (data) => {
    setSaved(data);
    try { localStorage.setItem('brixflow_leads', JSON.stringify(data)); } catch(e) {}
  };

  const persistKey = (k) => {
    setApiKey(k);
    try { localStorage.setItem('brixflow_key', k); } catch(e) {}
  };

  const toggleSector = (s) => {
    setSectors(prev => prev.includes(s) ? prev.filter(x=>x!==s) : [...prev, s]);
  };

  const buildPrompt = () => {
    if (mode === 'free') {
      return buildFilters(`Zoek BrixFlow leads. Vrije zoekopdracht: ${freeText}`);
    }
    let msg = `Zoek BrixFlow leads. Sectoren: ${sectors.join(', ')}. Markt: ${market}.`;
    if (keyword) msg += ` Keyword: "${keyword}".`;
    return buildFilters(msg);
  };

  const buildFilters = (base) => {
    const parts = [];
    if (minloc !== '1+') parts.push(`minimaal ${minloc} vestigingen`);
    if (reviews !== 'Geen voorkeur') parts.push(`óf minimaal ${reviews} Google-reviews totaal (ook bij 1 vestiging)`);
    if (activity !== 'Geen voorkeur') parts.push(`minimaal ${activity} nieuwe reviews recent (sluit bedrijven uit waarvan de laatste reviews meer dan 6 maanden oud zijn)`);
    if (response !== 'Geen voorkeur') parts.push(`reviewrespons: het bedrijf ${response.toLowerCase()} — geef response rate en gemiddelde reactietijd aan`);
    if (parts.length) return base + ` Kwalificatiecriteria: ${parts.join('; ')}.`;
    return base;
  };

  const runSearch = async () => {
    if (!apiKey) { alert('Voer eerst een Anthropic API-sleutel in (linker kolom onderaan).'); return; }
    if (mode === 'guided' && !sectors.length) { alert('Selecteer minimaal één sector.'); return; }
    if (mode === 'free' && !freeText.trim()) { alert('Vul in wat je zoekt.'); return; }

    setLoading(true);
    setResults([]);
    setStatusType('active');
    setStatus('Zoeken gestart…');

    const prompt = buildPrompt();
    setSearchHistory(prev => [{ prompt, time: new Date().toLocaleTimeString('nl-NL'), results: 0 }, ...prev.slice(0,9)]);

    const system = `You are a B2B lead researcher for BrixFlow, a SaaS tool that automatically replies to online reviews for businesses.

Find real, named companies matching the search criteria. For each company return ONLY a valid JSON object with these fields:
- company: name
- sector: sector
- locations: estimated number (integer)
- platforms: main review platforms
- score: High / Medium / Low
- contact: best contact method
- source: URL
- response_rate: estimated % of reviews they reply to (e.g. "~10%" or "onbekend")
- response_time: estimated avg reply time (e.g. "3-5 dagen" or "zelden" or "onbekend")
- notes: one short observation about their review situation

Return ONLY a valid JSON array. No markdown, no explanation. Find 8-14 real leads.`;

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          system,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await res.json();
      setStatus('Resultaten verwerken…');

      const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');
      const clean = text.replace(/```json|```/g, '').trim();
      let leads = [];
      try { leads = JSON.parse(clean); }
      catch(e) { const m = clean.match(/\[[\s\S]*\]/); if(m) leads = JSON.parse(m[0]); }

      const sorted = [...leads].sort((a,b) => {
        const o = {high:0,hoog:0,medium:1,med:1,low:2,laag:2};
        return (o[(a.score||'').toLowerCase()]||2) - (o[(b.score||'').toLowerCase()]||2);
      });

      setResults(sorted);
      setSearchHistory(prev => {
        const updated = [...prev];
        if (updated[0]) updated[0].results = sorted.length;
        return updated;
      });
      setStatusType('done');
      setStatus(`${sorted.length} leads gevonden — ${new Date().toLocaleTimeString('nl-NL')}`);
    } catch(err) {
      setStatusType('error');
      setStatus(`Fout: ${err.message}`);
    }
    setLoading(false);
  };

  const saveLead = (lead) => {
    if (saved.find(s => s.company === lead.company)) return;
    const newSaved = [...saved, { ...lead, status: 'Nieuw', savedAt: new Date().toLocaleDateString('nl-NL'), note: '' }];
    persistSaved(newSaved);
  };

  const updateStatus = (idx, status) => {
    const updated = [...saved];
    updated[idx].status = status;
    persistSaved(updated);
  };

  const deleteLead = (idx) => {
    const updated = saved.filter((_,i) => i !== idx);
    persistSaved(updated);
  };

  const saveNote = (idx) => {
    const updated = [...saved];
    updated[idx].note = noteText;
    persistSaved(updated);
    setActiveNote(null);
  };

  const exportCSV = (data) => {
    const h = ['Bedrijf','Sector','Vestigingen','Platforms','Score','Contact','Bron','Response rate','Reactietijd','Status','Notitie'];
    const rows = data.map(l => [l.company,l.sector,l.locations,l.platforms,l.score,l.contact,l.source,l.response_rate,l.response_time,l.status||'',l.note||'']
      .map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(','));
    const csv = [h.join(','), ...rows].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `brixflow-leads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const scoreColor = (s) => {
    const v = (s||'').toLowerCase();
    if (v==='high'||v==='hoog') return '#3ecf8e';
    if (v==='medium'||v==='med') return '#f5a623';
    return '#888';
  };

  return (
    <>
      <Head>
        <title>BrixFlow · Lead Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #09090b;
          --surface: #111113;
          --surface2: #18181b;
          --surface3: #222226;
          --border: #27272a;
          --border2: #3f3f46;
          --text: #fafafa;
          --muted: #71717a;
          --faint: #3f3f46;
          --accent: #7c6aff;
          --accent2: #a996ff;
          --green: #3ecf8e;
          --amber: #f5a623;
          --red: #ff5c5c;
          --r: 8px;
        }
        html, body { background: var(--bg); color: var(--text); font-family: 'Syne', sans-serif; min-height: 100vh; font-size: 14px; }
        button { font-family: 'Syne', sans-serif; cursor: pointer; }
        input, textarea { font-family: 'Syne', sans-serif; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

        .shell { display: flex; height: 100vh; overflow: hidden; }

        /* Sidebar */
        .sidebar { width: 270px; min-width: 270px; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
        .logo { padding: 20px 18px 16px; border-bottom: 1px solid var(--border); }
        .logo-mark { font-size: 17px; font-weight: 700; letter-spacing: -0.03em; color: var(--text); }
        .logo-mark span { color: var(--accent2); }
        .logo-sub { font-size: 10px; color: var(--muted); font-family: 'DM Mono', monospace; margin-top: 2px; letter-spacing: 0.05em; }

        .nav { padding: 12px 10px; border-bottom: 1px solid var(--border); display: flex; gap: 4px; }
        .nav-btn { flex: 1; padding: 7px 10px; font-size: 12px; font-weight: 500; border-radius: 6px; border: none; background: transparent; color: var(--muted); transition: all .15s; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .nav-btn:hover { background: var(--surface2); color: var(--text); }
        .nav-btn.active { background: var(--accent); color: #fff; }
        .nav-count { background: rgba(255,255,255,.15); border-radius: 99px; padding: 1px 6px; font-size: 10px; font-family: 'DM Mono', monospace; }

        .s-section { padding: 14px 14px 0; }
        .s-lbl { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin-bottom: 8px; display: block; }
        .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
        .chip { font-size: 11px; padding: 4px 9px; border-radius: 99px; border: 1px solid var(--border2); color: var(--muted); cursor: pointer; background: transparent; transition: all .12s; font-family: 'Syne', sans-serif; }
        .chip:hover { border-color: var(--accent); color: var(--accent2); }
        .chip.on { background: rgba(124,106,255,.18); border-color: var(--accent); color: var(--accent2); }
        .sdiv { height: 1px; background: var(--border); margin: 10px 0; }

        .api-wrap { padding: 14px; margin-top: auto; border-top: 1px solid var(--border); }
        .api-input { width: 100%; font-family: 'DM Mono', monospace; font-size: 11px; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--muted); padding: 8px 10px; outline: none; transition: border .15s; }
        .api-input:focus { border-color: var(--accent); color: var(--text); }
        .api-hint { font-size: 10px; color: var(--faint); margin-top: 5px; line-height: 1.5; }
        .api-hint a { color: var(--accent2); text-decoration: none; }

        /* Main */
        .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        .topbar { padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; background: var(--surface); }
        .mode-row { display: flex; gap: 6px; }
        .mode-btn { font-size: 12px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border2); color: var(--muted); background: transparent; font-weight: 500; transition: all .15s; }
        .mode-btn.active { background: var(--surface2); color: var(--text); border-color: var(--border2); }
        .search-wrap { flex: 1; position: relative; }
        .s-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--faint); font-size: 13px; }
        .s-in { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--r); color: var(--text); font-family: 'Syne', sans-serif; font-size: 13px; padding: 9px 12px 9px 34px; outline: none; transition: border .15s; }
        .s-in:focus { border-color: var(--accent); }
        .s-in::placeholder { color: var(--faint); }
        .free-ta { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--r); color: var(--text); font-family: 'Syne', sans-serif; font-size: 13px; padding: 9px 12px; outline: none; transition: border .15s; resize: none; }
        .free-ta:focus { border-color: var(--accent); }
        .free-ta::placeholder { color: var(--faint); }
        .run-btn { background: var(--accent); color: #fff; border: none; border-radius: var(--r); font-size: 13px; font-weight: 600; padding: 9px 18px; white-space: nowrap; transition: opacity .15s, transform .1s; display: flex; align-items: center; gap: 7px; letter-spacing: -0.01em; }
        .run-btn:hover { opacity: .85; }
        .run-btn:active { transform: scale(.97); }
        .run-btn:disabled { opacity: .4; cursor: not-allowed; }
        .act-btn { background: transparent; color: var(--muted); border: 1px solid var(--border2); border-radius: var(--r); font-size: 12px; padding: 9px 12px; display: flex; align-items: center; gap: 5px; transition: all .15s; white-space: nowrap; }
        .act-btn:hover { border-color: var(--accent); color: var(--accent2); }
        .act-btn:disabled { opacity: .3; cursor: not-allowed; }

        .statusbar { padding: 7px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; background: var(--surface); min-height: 32px; }
        .sdot { width: 6px; height: 6px; border-radius: 50%; background: var(--faint); flex-shrink: 0; transition: background .3s; }
        .sdot.active { background: var(--accent); animation: pulse 1s infinite; }
        .sdot.done { background: var(--green); }
        .sdot.error { background: var(--red); }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        .stext { font-size: 11px; color: var(--muted); font-family: 'DM Mono', monospace; }

        /* Results */
        .results-area { flex: 1; overflow-y: auto; padding: 20px; }

        .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--faint); text-align: center; }
        .empty-icon { font-size: 40px; opacity: .2; }
        .empty-title { font-size: 15px; color: var(--muted); font-weight: 600; }
        .empty-sub { font-size: 12px; color: var(--faint); max-width: 300px; line-height: 1.7; }

        .stats-row { display: flex; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
        .stat { display: flex; align-items: baseline; gap: 6px; }
        .stat-n { font-size: 22px; font-weight: 700; font-family: 'DM Mono', monospace; }
        .stat-l { font-size: 11px; color: var(--faint); }
        .stat-dot { width: 7px; height: 7px; border-radius: 50%; }

        /* Lead cards */
        .leads-grid { display: flex; flex-direction: column; gap: 8px; }
        .lead-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; transition: border-color .15s; }
        .lead-card:hover { border-color: var(--border2); }
        .lead-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .lead-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
        .lead-sector { font-size: 11px; color: var(--muted); margin-top: 2px; }
        .lead-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .badge { font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 99px; font-family: 'DM Mono', monospace; }
        .lead-meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px; }
        .meta-item { background: var(--surface2); border-radius: 6px; padding: 7px 10px; }
        .meta-lbl { font-size: 10px; color: var(--faint); margin-bottom: 2px; text-transform: uppercase; letter-spacing: .05em; }
        .meta-val { font-size: 12px; color: var(--text); font-family: 'DM Mono', monospace; }
        .lead-note { font-size: 11px; color: var(--muted); background: var(--surface2); border-radius: 6px; padding: 7px 10px; margin-bottom: 10px; line-height: 1.5; border-left: 2px solid var(--accent); }
        .lead-actions { display: flex; align-items: center; gap: 6px; }
        .save-btn { font-size: 11px; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--accent); color: var(--accent2); background: rgba(124,106,255,.1); font-weight: 500; transition: all .15s; }
        .save-btn:hover { background: rgba(124,106,255,.2); }
        .save-btn.saved { border-color: var(--green); color: var(--green); background: rgba(62,207,142,.1); }
        .src-a { font-size: 11px; color: var(--muted); text-decoration: none; padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border2); transition: all .15s; }
        .src-a:hover { color: var(--accent2); border-color: var(--accent); }

        /* Dashboard */
        .dash-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
        .dash-title { font-size: 16px; font-weight: 700; }
        .dash-empty { text-align: center; padding: 60px 20px; color: var(--faint); }
        .dash-grid { display: flex; flex-direction: column; gap: 8px; }
        .dash-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
        .dash-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .dash-name { font-size: 13px; font-weight: 600; flex: 1; min-width: 120px; }
        .dash-info { font-size: 11px; color: var(--muted); font-family: 'DM Mono', monospace; }
        .status-sel { font-size: 11px; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border2); background: var(--surface2); color: var(--text); font-family: 'Syne', sans-serif; cursor: pointer; outline: none; }
        .note-btn { font-size: 11px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border2); color: var(--muted); background: transparent; transition: all .15s; }
        .note-btn:hover { border-color: var(--accent); color: var(--accent2); }
        .del-btn { font-size: 11px; padding: 4px 8px; border-radius: 6px; border: 1px solid transparent; color: var(--faint); background: transparent; transition: all .15s; }
        .del-btn:hover { border-color: var(--red); color: var(--red); }
        .dash-note-text { font-size: 11px; color: var(--muted); margin-top: 8px; padding: 7px 10px; background: var(--surface2); border-radius: 6px; border-left: 2px solid var(--accent); line-height: 1.5; }

        /* Note modal */
        .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .modal { background: var(--surface); border: 1px solid var(--border2); border-radius: 12px; padding: 20px; width: 400px; max-width: 90vw; }
        .modal-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
        .modal-ta { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: 'Syne', sans-serif; font-size: 13px; padding: 10px 12px; outline: none; resize: vertical; min-height: 80px; }
        .modal-ta:focus { border-color: var(--accent); }
        .modal-actions { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }
        .modal-save { background: var(--accent); color: #fff; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; padding: 7px 16px; }
        .modal-cancel { background: transparent; color: var(--muted); border: 1px solid var(--border2); border-radius: 6px; font-size: 12px; padding: 7px 12px; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }
      `}</style>

      <div className="shell">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="logo">
            <div className="logo-mark">Brix<span>Flow</span></div>
            <div className="logo-sub">lead dashboard v1.0</div>
          </div>

          <nav className="nav">
            <button className={`nav-btn ${tab==='search'?'active':''}`} onClick={()=>setTab('search')}>
              ⌕ Zoeken
            </button>
            <button className={`nav-btn ${tab==='dashboard'?'active':''}`} onClick={()=>setTab('dashboard')}>
              ◫ Leads <span className="nav-count">{saved.length}</span>
            </button>
          </nav>

          <div className="s-section">
            <span className="s-lbl">Sectoren</span>
            <div className="chips">
              {SECTORS.map(s => (
                <span key={s} className={`chip ${sectors.includes(s)?'on':''}`} onClick={()=>toggleSector(s)}>{s}</span>
              ))}
            </div>

            <span className="s-lbl">Min. vestigingen</span>
            <div className="chips">
              {MINLOC.map(v => (
                <span key={v} className={`chip ${minloc===v?'on':''}`} onClick={()=>setMinloc(v)}>{v}</span>
              ))}
            </div>

            <div className="sdiv" />

            <span className="s-lbl">Of minimaal reviewvolume</span>
            <div className="chips">
              {REVIEWS.map(v => (
                <span key={v} className={`chip ${reviews===v?'on':''}`} onClick={()=>setReviews(v)}>{v}</span>
              ))}
            </div>

            <div className="sdiv" />

            <span className="s-lbl">Maandelijkse activiteit</span>
            <div className="chips">
              {ACTIVITY.map(v => (
                <span key={v} className={`chip ${activity===v?'on':''}`} onClick={()=>setActivity(v)}>{v}</span>
              ))}
            </div>

            <div className="sdiv" />

            <span className="s-lbl">Reviewrespons</span>
            <div className="chips">
              {RESPONSE.map(v => (
                <span key={v} className={`chip ${response===v?'on':''}`} onClick={()=>setResponse(v)}>{v}</span>
              ))}
            </div>

            <div className="sdiv" />

            <span className="s-lbl">Markt</span>
            <div className="chips">
              {MARKETS.map(v => (
                <span key={v} className={`chip ${market===v?'on':''}`} onClick={()=>setMarket(v)}>{v}</span>
              ))}
            </div>
          </div>

          <div className="api-wrap">
            <span className="s-lbl">Anthropic API key</span>
            <input className="api-input" type="password" value={apiKey} onChange={e=>persistKey(e.target.value)} placeholder="sk-ant-..." autoComplete="off" />
            <div className="api-hint">
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> — wordt lokaal opgeslagen.
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="main">
          {/* Topbar */}
          <div className="topbar">
            <div className="mode-row">
              <button className={`mode-btn ${mode==='guided'?'active':''}`} onClick={()=>setMode('guided')}>Geleide zoekopdracht</button>
              <button className={`mode-btn ${mode==='free'?'active':''}`} onClick={()=>setMode('free')}>Vrije zoekopdracht</button>
            </div>

            {mode === 'guided' ? (
              <div className="search-wrap">
                <span className="s-icon">⌕</span>
                <input className="s-in" value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder='Optioneel: stad of keyword — bijv. "Amsterdam koffie"' onKeyDown={e=>e.key==='Enter'&&runSearch()} />
              </div>
            ) : (
              <div className="search-wrap">
                <textarea className="free-ta" rows={2} value={freeText} onChange={e=>setFreeText(e.target.value)} placeholder='Beschrijf wat je zoekt — bijv. "Koffietentjes in Laren met actieve Google-reviews"' onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&(e.preventDefault(),runSearch())} />
              </div>
            )}

            <button className="run-btn" onClick={runSearch} disabled={loading}>
              {loading ? <span className="spinner" /> : '⌕'} Zoek leads
            </button>

            {results.length > 0 && (
              <button className="act-btn" onClick={()=>exportCSV(results)}>↓ CSV</button>
            )}
          </div>

          {/* Statusbar */}
          <div className="statusbar">
            <div className={`sdot ${statusType}`} />
            <span className="stext">{statusMsg}</span>
          </div>

          {/* Content */}
          <div className="results-area">
            {tab === 'search' && (
              <>
                {results.length === 0 && !loading && (
                  <div className="empty">
                    <div className="empty-icon">◎</div>
                    <div className="empty-title">Nog geen leads</div>
                    <div className="empty-sub">Stel je filters in via de zijbalk en klik op "Zoek leads".</div>
                  </div>
                )}

                {results.length > 0 && (
                  <>
                    <div className="stats-row">
                      <div className="stat"><span className="stat-n">{results.length}</span><span className="stat-l">leads</span></div>
                      <div className="stat"><span className="stat-dot" style={{background:'#3ecf8e'}} /><span className="stat-n">{results.filter(l=>['high','hoog'].includes((l.score||'').toLowerCase())).length}</span><span className="stat-l">hoog</span></div>
                      <div className="stat"><span className="stat-dot" style={{background:'#f5a623'}} /><span className="stat-n">{results.filter(l=>['medium','med'].includes((l.score||'').toLowerCase())).length}</span><span className="stat-l">middel</span></div>
                    </div>

                    <div className="leads-grid">
                      {results.map((lead, i) => {
                        const isSaved = saved.find(s=>s.company===lead.company);
                        return (
                          <div key={i} className="lead-card">
                            <div className="lead-header">
                              <div>
                                <div className="lead-name">{lead.company}</div>
                                <div className="lead-sector">{lead.sector} · {lead.locations} vestigingen</div>
                              </div>
                              <div className="lead-badges">
                                <span className="badge" style={{background:`${scoreColor(lead.score)}22`,color:scoreColor(lead.score),border:`1px solid ${scoreColor(lead.score)}44`}}>{lead.score}</span>
                              </div>
                            </div>

                            <div className="lead-meta">
                              <div className="meta-item">
                                <div className="meta-lbl">Platforms</div>
                                <div className="meta-val">{lead.platforms||'—'}</div>
                              </div>
                              <div className="meta-item">
                                <div className="meta-lbl">Response rate</div>
                                <div className="meta-val">{lead.response_rate||'onbekend'}</div>
                              </div>
                              <div className="meta-item">
                                <div className="meta-lbl">Reactietijd</div>
                                <div className="meta-val">{lead.response_time||'onbekend'}</div>
                              </div>
                            </div>

                            {lead.notes && (
                              <div className="lead-note">{lead.notes}</div>
                            )}

                            <div className="lead-actions">
                              <button className={`save-btn ${isSaved?'saved':''}`} onClick={()=>saveLead(lead)}>
                                {isSaved ? '✓ Opgeslagen' : '+ Opslaan'}
                              </button>
                              <span style={{fontSize:11,color:'var(--muted)',marginLeft:4}}>{lead.contact}</span>
                              <div style={{marginLeft:'auto'}}>
                                {lead.source && <a className="src-a" href={lead.source} target="_blank" rel="noreferrer">↗ bron</a>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {tab === 'dashboard' && (
              <>
                <div className="dash-header">
                  <div className="dash-title">Opgeslagen leads <span style={{color:'var(--muted)',fontWeight:400,fontSize:13}}>({saved.length})</span></div>
                  <div style={{display:'flex',gap:8}}>
                    {saved.length > 0 && (
                      <button className="act-btn" onClick={()=>exportCSV(saved)}>↓ Export CSV</button>
                    )}
                  </div>
                </div>

                {saved.length === 0 ? (
                  <div className="dash-empty">
                    <div style={{fontSize:36,opacity:.2,marginBottom:12}}>◫</div>
                    <div style={{fontSize:14,color:'var(--muted)',fontWeight:600,marginBottom:6}}>Geen leads opgeslagen</div>
                    <div style={{fontSize:12,color:'var(--faint)'}}>Zoek leads en klik op "+ Opslaan" om ze hier te bewaren.</div>
                  </div>
                ) : (
                  <div className="dash-grid">
                    {saved.map((lead, i) => (
                      <div key={i} className="dash-card">
                        <div className="dash-row">
                          <div className="dash-name">{lead.company}</div>
                          <span className="dash-info">{lead.sector}</span>
                          <span className="dash-info">{lead.locations} vest.</span>
                          <span className="badge" style={{background:`${scoreColor(lead.score)}22`,color:scoreColor(lead.score),border:`1px solid ${scoreColor(lead.score)}44`,fontSize:10,padding:'3px 8px',borderRadius:99,fontFamily:'DM Mono,monospace',fontWeight:600}}>{lead.score}</span>
                          <select className="status-sel" value={lead.status||'Nieuw'} onChange={e=>updateStatus(i,e.target.value)} style={{color:STATUS_COLORS[lead.status||'Nieuw']}}>
                            {STATUS_OPTIONS.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                          <button className="note-btn" onClick={()=>{setActiveNote(i);setNoteText(lead.note||'');}}>✎ Notitie</button>
                          {lead.source && <a className="src-a" href={lead.source} target="_blank" rel="noreferrer" style={{fontSize:11,color:'var(--muted)',textDecoration:'none'}}>↗</a>}
                          <button className="del-btn" onClick={()=>deleteLead(i)}>✕</button>
                        </div>
                        {lead.note && <div className="dash-note-text">{lead.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Note modal */}
      {activeNote !== null && (
        <div className="modal-bg" onClick={()=>setActiveNote(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Notitie — {saved[activeNote]?.company}</div>
            <textarea className="modal-ta" rows={4} value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Voeg een notitie toe over deze lead..." autoFocus />
            <div className="modal-actions">
              <button className="modal-cancel" onClick={()=>setActiveNote(null)}>Annuleer</button>
              <button className="modal-save" onClick={()=>saveNote(activeNote)}>Opslaan</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
