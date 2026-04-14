import { useState, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Constants ───────────────────────────────────────────────────────────────
const COLS = [
  { key: "r1",    label: "R1" },
  { key: "r2",    label: "R2" },
  { key: "r3",    label: "R3" },
  { key: "r4",    label: "R4" },
  { key: "r5",    label: "R5" },
  { key: "bonus", label: "BONUS", accent: true },
  { key: "potw",  label: "POTW",  accent: true },
  { key: "qod",   label: "QOD",   accent: true },
];
const SCORE_KEYS = COLS.map(c => c.key);
const emptyScores = () => Object.fromEntries(SCORE_KEYS.map(k => [k, ""]));
const totalFor = s => SCORE_KEYS.reduce((sum, k) => sum + (parseFloat(s[k]) || 0), 0);

const MONTH_MAP = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
};

const STORAGE_KEY = "quizzicle_v1";

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { venueList: [], venues: {}, activeVenue: null };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// ─── Excel Parser ─────────────────────────────────────────────────────────────
function parseWorkbook(wb) {
  const isGameSheet = name => {
    const match = name.trim().match(/^BRT SCOREBOARD\s+(\w+)\s+(\d+)$/i);
    return match && MONTH_MAP[match[1].toLowerCase()] && !isNaN(parseInt(match[2]));
  };
  const isLeaderboardSheet = name => /season|leader|board|standing/i.test(name);

  const gameDates = [];
  const leaderboardRaw = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
    if (!rows.length) continue;

    if (isGameSheet(sheetName)) {
      const teams = rows.map(row => {
        const norm = {};
        for (const [k, v] of Object.entries(row)) norm[k.trim().toLowerCase()] = v;
        const name = norm["team"] || norm["team name"] || norm["name"] || Object.values(norm)[0] || "Unknown";
        const scores = {
          r1:    norm["r1"]    ?? norm["round 1"] ?? norm["round1"] ?? "",
          r2:    norm["r2"]    ?? norm["round 2"] ?? norm["round2"] ?? "",
          r3:    norm["r3"]    ?? norm["round 3"] ?? norm["round3"] ?? "",
          r4:    norm["r4"]    ?? norm["round 4"] ?? norm["round4"] ?? "",
          r5:    norm["r5"]    ?? norm["round 5"] ?? norm["round5"] ?? "",
          bonus: norm["bonus"] ?? norm["bonus round"] ?? "",
          potw:  norm["potw"]  ?? norm["phrase"]  ?? norm["phrase of the week"] ?? "",
          qod:   norm["qod"]   ?? norm["question of the day"] ?? norm["question"] ?? "",
        };
        return { name: String(name).trim(), scores };
      }).filter(t => t.name && t.name !== "Unknown");
      gameDates.push({ date: sheetName.trim(), teams });

    } else if (isLeaderboardSheet(sheetName)) {
        // Sheet has no header row — row 1 is a title, data starts row 2
        // Column A = rank number, Column B = team name, then week columns, last = Total Points
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  
        // Find the first row that has a recognizable date in col index 2+ (skip title row)
        // Row index 0 = title, row index 1+ = data
      const dataRows = rows.slice(1).filter(r => r[1] && isNaN(Number(r[1])));
  
        // Get week column headers from first data row's sheet — use raw array mode
        // Actually grab headers from row 0 col 2 onward (the title row has date headers)
      const headerRow = rows[0]; // "Leaderboard Season 2", "24-Feb", "3-Mar", ... "Total Points"
      const weekHeaders = headerRow.slice(2, -1).map(h => String(h).trim()).filter(Boolean);
  
      const parsed = dataRows.map(row => {
        const name = String(row[1] || "").trim();
        if (!name) return null;
        const total = parseFloat(row[row.length - 1]) || 0;
        const weeks = {};
        weekHeaders.forEach((w, i) => {
          weeks[w] = parseFloat(row[i + 2]) || 0;
        });
        return { name, weeks, total };
      }).filter(Boolean);
  
      leaderboardRaw.push(...parsed);
    }
  }


  gameDates.sort((a, b) => {
    const parse = d => { const [m, day] = d.split(" "); return (MONTH_MAP[m.toLowerCase()] || 0) * 100 + parseInt(day); };
    return parse(a.date) - parse(b.date);
  });

  return { gameDates, leaderboard: leaderboardRaw };
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const initial = loadState();
  const [venueList, setVenueList]     = useState(initial.venueList || []);
  const [venues, setVenues]           = useState(initial.venues || {});
  const [activeVenue, setActiveVenue] = useState(initial.activeVenue || null);
  const [tab, setTab]                 = useState("entry");
  const [newVenueName, setNewVenueName] = useState("");
  const [venueModal, setVenueModal]   = useState(false);
  const [newTeam, setNewTeam]         = useState("");
  const [activeDate, setActiveDate]   = useState(null);
  const [importMsg, setImportMsg]     = useState(null);
  const inputRefs = useRef({});
  const fileInputRef = useRef(null);

  // Persist to localStorage on every state change
  useEffect(() => {
    saveState({ venueList, venues, activeVenue });
  }, [venueList, venues, activeVenue]);

  const venue = activeVenue ? venues[activeVenue] : null;
  const teams = venue?.teams || [];

  // ── Venue helpers ──
  const addVenue = () => {
    const n = newVenueName.trim();
    if (!n || venueList.includes(n)) return;
    setVenueList(v => [...v, n]);
    setVenues(v => ({ ...v, [n]: { teams: [], gameDates: [], leaderboard: [] } }));
    setActiveVenue(n);
    setNewVenueName("");
    setVenueModal(false);
  };

  const deleteVenue = (name) => {
    setVenueList(v => v.filter(x => x !== name));
    setVenues(v => { const next = { ...v }; delete next[name]; return next; });
    if (activeVenue === name) setActiveVenue(venueList.filter(x => x !== name)[0] || null);
  };

  const mutVenue = (name, fn) =>
    setVenues(prev => ({ ...prev, [name]: fn(prev[name]) }));

  // ── Team helpers ──
  const setScore = (id, col, val) =>
    mutVenue(activeVenue, v => ({
      ...v,
      teams: v.teams.map(t => t.id === id ? { ...t, scores: { ...t.scores, [col]: val } } : t),
    }));

  const addTeam = () => {
    const n = newTeam.trim();
    if (!n || !activeVenue) return;
    mutVenue(activeVenue, v => ({
      ...v,
      teams: [...v.teams, { id: Date.now(), name: n, scores: emptyScores() }],
    }));
    setNewTeam("");
  };

  const removeTeam = id =>
    mutVenue(activeVenue, v => ({ ...v, teams: v.teams.filter(t => t.id !== id) }));

  const clearScores = () =>
    mutVenue(activeVenue, v => ({
      ...v,
      teams: v.teams.map(t => ({ ...t, scores: emptyScores() })),
    }));

  // ── Keyboard nav ──
  const nav = (e, ti, ci) => {
    const map = { ArrowRight:[0,1], Tab:[0,1], ArrowLeft:[0,-1], ArrowDown:[1,0], ArrowUp:[-1,0] };
    if (!map[e.key]) return;
    e.preventDefault();
    const ref = inputRefs.current[`${ti + map[e.key][0]}-${ci + map[e.key][1]}`];
    if (ref) ref.focus();
  };

  // ── Excel import ──
  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file || !activeVenue) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const wb = XLSX.read(evt.target.result, { type: "array" });
        const { gameDates, leaderboard } = parseWorkbook(wb);
        const latestTeams = gameDates.length
          ? gameDates[gameDates.length - 1].teams.map((t, i) => ({
              id: Date.now() + i, name: t.name, scores: t.scores,
            }))
          : [];
        mutVenue(activeVenue, v => ({ ...v, gameDates, leaderboard, teams: latestTeams }));
        if (gameDates.length) setActiveDate(gameDates[gameDates.length - 1].date);
        setImportMsg(`✓ Imported ${gameDates.length} game night${gameDates.length !== 1 ? "s" : ""} for ${activeVenue}`);
        setTimeout(() => setImportMsg(null), 4000);
      } catch (err) {
        setImportMsg(`✗ Error: ${err.message}`);
        setTimeout(() => setImportMsg(null), 5000);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  }, [activeVenue]);

  const loadGameNight = (date) => {
    const gd = venues[activeVenue]?.gameDates?.find(g => g.date === date);
    if (!gd) return;
    mutVenue(activeVenue, v => ({
      ...v,
      teams: gd.teams.map((t, i) => ({ id: Date.now() + i, name: t.name, scores: t.scores })),
    }));
    setActiveDate(date);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --g: #00FF94; --gd: rgba(0,255,148,.1); --gb: rgba(0,255,148,.22);
          --bg: #0a0a0a; --s1: #111; --s2: #161616; --br: #222; --t: #f0f0f0; --mu: #555;
          --mono: 'IBM Plex Mono', monospace; --sans: 'IBM Plex Sans', sans-serif;
        }
        body { background: var(--bg); color: var(--t); font-family: var(--sans); }
        input[type=number] { -moz-appearance: textfield; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: var(--bg); }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(5px); } to { opacity:1; transform:none; } }
        @keyframes slideIn { from { opacity:0; transform:translateX(12px); } to { opacity:1; transform:none; } }
        .fade { animation: fadeUp .18s ease forwards; }
        .slide { animation: slideIn .2s ease forwards; }
        input:focus { outline: none; border-color: var(--g) !important; }
        button:focus { outline: none; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

        {/* HEADER */}
        <header style={{
          position: "sticky", top: 0, zIndex: 50, height: 52,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 24px", background: "var(--s1)", borderBottom: "1px solid var(--br)", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 15, color: "var(--g)", letterSpacing: 2 }}>
              GET QUIZZICLE
            </span>
            <span style={{ color: "var(--br)", fontSize: 20 }}>|</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 1.5 }}>
              SCORE TRACKER
            </span>
          </div>
          <div style={{ display: "flex", gap: 2, background: "var(--bg)", borderRadius: 5, padding: 3 }}>
            {[["entry", "ENTRY"], ["season", "SEASON"]].map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700, letterSpacing: 1,
                padding: "5px 18px", borderRadius: 4, border: "none", cursor: "pointer",
                background: tab === k ? "var(--g)" : "transparent",
                color: tab === k ? "#000" : "var(--mu)", transition: "all .15s",
              }}>{l}</button>
            ))}
          </div>
        </header>

        {/* VENUE BAR */}
        <div style={{
          borderBottom: "1px solid var(--br)", padding: "9px 24px",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "var(--s1)",
        }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 2, marginRight: 4 }}>VENUE</span>
          {venueList.length === 0 && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)" }}>None yet —</span>
          )}
          {venueList.map(v => (
            <button key={v} onClick={() => { setActiveVenue(v); setActiveDate(null); }} style={{
              fontFamily: "var(--mono)", fontSize: 11, padding: "4px 13px", borderRadius: 3,
              border: "1px solid", cursor: "pointer", transition: "all .15s", letterSpacing: .5,
              borderColor: activeVenue === v ? "var(--g)" : "var(--br)",
              background: activeVenue === v ? "var(--gd)" : "transparent",
              color: activeVenue === v ? "var(--g)" : "var(--mu)",
            }}>{v}</button>
          ))}
          <button onClick={() => setVenueModal(true)} style={{
            fontFamily: "var(--mono)", fontSize: 10, padding: "4px 12px", letterSpacing: 1,
            borderRadius: 3, border: "1px dashed var(--br)", background: "transparent",
            color: "var(--mu)", cursor: "pointer",
          }}>+ VENUE</button>
        </div>

        {/* TOAST */}
        {importMsg && (
          <div className="slide" style={{
            position: "fixed", bottom: 24, right: 24, zIndex: 300,
            background: importMsg.startsWith("✓") ? "var(--gd)" : "rgba(255,60,60,.1)",
            border: `1px solid ${importMsg.startsWith("✓") ? "var(--gb)" : "rgba(255,60,60,.3)"}`,
            borderRadius: 6, padding: "10px 18px",
            fontFamily: "var(--mono)", fontSize: 12,
            color: importMsg.startsWith("✓") ? "var(--g)" : "#ff6060",
            maxWidth: 380,
          }}>
            {importMsg}
          </div>
        )}

        {/* Hidden file input */}
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls"
          onChange={handleFile} style={{ display: "none" }} />

        {/* MAIN */}
        <main style={{ padding: 24, maxWidth: 1080, margin: "0 auto" }}>
          {!activeVenue ? (
            <EmptyState onAdd={() => setVenueModal(true)} />
          ) : tab === "entry" ? (
            <EntryTab
              venueData={venues[activeVenue]}
              teams={teams}
              setScore={setScore}
              removeTeam={removeTeam}
              clearScores={clearScores}
              newTeam={newTeam}
              setNewTeam={setNewTeam}
              addTeam={addTeam}
              nav={nav}
              inputRefs={inputRefs}
              activeDate={activeDate}
              loadGameNight={loadGameNight}
              onImport={() => fileInputRef.current?.click()}
            />
          ) : (
            <SeasonTab venueData={venues[activeVenue]} venue={activeVenue} />
          )}
        </main>
      </div>

      {/* VENUE MODAL */}
      {venueModal && (
        <div onClick={() => setVenueModal(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.8)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
        }}>
          <div onClick={e => e.stopPropagation()} className="fade" style={{
            background: "var(--s1)", border: "1px solid var(--br)",
            borderRadius: 8, padding: 28, width: 380, maxWidth: "90vw",
          }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--g)", letterSpacing: 2, marginBottom: 20 }}>
              VENUES
            </div>
            {venueList.length === 0 && (
              <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)", marginBottom: 16 }}>
                No venues yet. Add your first one below.
              </p>
            )}
            {venueList.map(v => (
              <div key={v} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "9px 0", borderBottom: "1px solid var(--br)",
              }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--t)" }}>{v}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)" }}>
                    {(venues[v]?.gameDates || []).length} nights
                  </span>
                  <button onClick={() => deleteVenue(v)} style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)",
                    transition: "color .1s",
                  }}
                    onMouseEnter={e => e.target.style.color = "#f55"}
                    onMouseLeave={e => e.target.style.color = "var(--mu)"}
                  >DELETE</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <input placeholder="Venue name…" value={newVenueName}
                onChange={e => setNewVenueName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addVenue()}
                style={{ ...iSty, flex: 1 }} />
              <button onClick={addVenue} style={bSty}>ADD</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ onAdd }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 20, padding: "80px 24px", textAlign: "center",
    }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 28, color: "var(--g)", letterSpacing: 4, fontWeight: 700 }}>
        GET QUIZZICLE
      </div>
      <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--mu)", letterSpacing: 1, maxWidth: 360, lineHeight: 1.9 }}>
        No venues yet. Add your first venue to start tracking — or import an Excel workbook to load a full season.
      </div>
      <button onClick={onAdd} style={{ ...bSty, fontSize: 13, padding: "10px 28px" }}>
        + ADD VENUE
      </button>
    </div>
  );
}

// ─── Entry Tab ────────────────────────────────────────────────────────────────
function EntryTab({ venueData, teams, setScore, removeTeam, clearScores, newTeam, setNewTeam, addTeam, nav, inputRefs, activeDate, loadGameNight, onImport }) {
  const gameDates = venueData?.gameDates || [];
  const sorted = [...teams].sort((a, b) => totalFor(b.scores) - totalFor(a.scores));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {gameDates.length > 0 && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 2 }}>NIGHT</span>
          )}
          {gameDates.map(gd => (
            <button key={gd.date} onClick={() => loadGameNight(gd.date)} style={{
              fontFamily: "var(--mono)", fontSize: 11, padding: "4px 12px", borderRadius: 3,
              border: "1px solid", cursor: "pointer", transition: "all .15s",
              borderColor: activeDate === gd.date ? "var(--g)" : "var(--br)",
              background: activeDate === gd.date ? "var(--gd)" : "transparent",
              color: activeDate === gd.date ? "var(--g)" : "var(--mu)",
            }}>{gd.date}</button>
          ))}
          {gameDates.length === 0 && (
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)" }}>
              Live entry — add teams below or import Excel
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {teams.length > 0 && (
            <button onClick={clearScores} style={{
              ...bSty, fontSize: 10, padding: "6px 14px",
              background: "transparent", borderColor: "var(--br)", color: "var(--mu)",
            }}>CLEAR SCORES</button>
          )}
          <button onClick={onImport} style={{ ...bSty, fontSize: 10, padding: "6px 14px" }}>
            ↑ IMPORT EXCEL
          </button>
        </div>
      </div>

      {/* Score grid */}
      <div style={{ background: "var(--s1)", border: "1px solid var(--br)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 740 }}>
            <thead>
              <tr style={{ background: "var(--s2)" }}>
                <th style={thSty({ textAlign: "left", paddingLeft: 16, width: 200 })}>TEAM</th>
                {COLS.map(c => (
                  <th key={c.key} style={thSty({ color: c.accent ? "var(--g)" : undefined })}>{c.label}</th>
                ))}
                <th style={thSty({ color: "var(--g)", width: 76 })}>TOTAL</th>
                <th style={thSty({ width: 34 })} />
              </tr>
            </thead>
            <tbody>
              {teams.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 3} style={{
                    padding: "44px 16px", textAlign: "center",
                    fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)", letterSpacing: 1,
                  }}>
                    NO TEAMS — ADD BELOW OR IMPORT EXCEL
                  </td>
                </tr>
              )}
              {teams.map((team, ti) => {
                const tot = totalFor(team.scores);
                return (
                  <tr key={team.id} className="fade" style={{
                    borderTop: "1px solid var(--br)",
                    background: ti % 2 === 0 ? "transparent" : "rgba(255,255,255,.012)",
                  }}>
                    <td style={{ padding: "8px 16px", fontFamily: "var(--mono)", fontSize: 13, color: "var(--t)", fontWeight: 600 }}>
                      {team.name}
                    </td>
                    {COLS.map((c, ci) => {
                      const filled = team.scores[c.key] !== "";
                      return (
                        <td key={c.key} style={{ padding: "5px 3px", textAlign: "center" }}>
                          <input
                            ref={el => inputRefs.current[`${ti}-${ci}`] = el}
                            type="number"
                            value={team.scores[c.key]}
                            onChange={e => setScore(team.id, c.key, e.target.value)}
                            onKeyDown={e => nav(e, ti, ci)}
                            style={{
                              width: 50, height: 36, textAlign: "center",
                              fontFamily: "var(--mono)", fontSize: 15, fontWeight: 700,
                              borderRadius: 4, border: "1px solid", transition: "border-color .1s, background .1s",
                              borderColor: filled ? (c.accent ? "var(--gb)" : "#303030") : "var(--br)",
                              background: filled ? (c.accent ? "var(--gd)" : "rgba(255,255,255,.04)") : "rgba(255,255,255,.02)",
                              color: c.accent ? "var(--g)" : "var(--t)",
                            }}
                          />
                        </td>
                      );
                    })}
                    <td style={{ textAlign: "center", padding: "5px 8px" }}>
                      <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 21, color: tot > 0 ? "var(--g)" : "var(--mu)" }}>
                        {tot > 0 ? tot : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button onClick={() => removeTeam(team.id)} style={{
                        background: "none", border: "none", cursor: "pointer",
                        fontSize: 13, color: "var(--mu)", padding: 4, lineHeight: 1, transition: "color .1s",
                      }}
                        onMouseEnter={e => e.target.style.color = "#f55"}
                        onMouseLeave={e => e.target.style.color = "var(--mu)"}
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {teams.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "1px solid #2a2a2a" }}>
                  <td style={{ padding: "7px 16px", fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 1 }}>AVG</td>
                  {COLS.map(c => {
                    const vals = teams.map(t => parseFloat(t.scores[c.key]) || 0);
                    const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
                    return <td key={c.key} style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)", padding: "7px 3px" }}>{avg}</td>;
                  })}
                  <td style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)" }}>
                    {(teams.reduce((s, t) => s + totalFor(t.scores), 0) / teams.length).toFixed(1)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add team */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input placeholder="Team name…" value={newTeam}
          onChange={e => setNewTeam(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addTeam()}
          style={{ ...iSty, flex: 1, maxWidth: 300 }} />
        <button onClick={addTeam} style={bSty}>+ ADD TEAM</button>
      </div>

      {/* Live leaderboard */}
      {teams.length > 0 && (
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 2, marginBottom: 10 }}>
            LIVE LEADERBOARD
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {sorted.map((t, i) => (
              <LeaderRow key={t.id} team={t} rank={i + 1} topScore={totalFor(sorted[0].scores)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LeaderRow({ team, rank, topScore }) {
  const tot = totalFor(team.scores);
  const pct = topScore > 0 ? Math.round((tot / topScore) * 100) : 0;
  const first = rank === 1;
  return (
    <div style={{
      position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 14,
      padding: "10px 16px", borderRadius: 6, border: "1px solid",
      borderColor: first ? "var(--gb)" : "var(--br)", background: first ? "var(--gd)" : "var(--s1)",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`,
        background: first ? "rgba(0,255,148,.05)" : "rgba(255,255,255,.015)",
        transition: "width .5s ease", pointerEvents: "none",
      }} />
      <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 11, width: 26, color: first ? "var(--g)" : "var(--mu)", position: "relative", flexShrink: 0 }}>
        {first ? "▲1" : `#${rank}`}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--t)", flex: 1, fontWeight: first ? 700 : 400, position: "relative" }}>
        {team.name}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, color: "var(--g)", position: "relative" }}>
        {tot || 0}
      </span>
    </div>
  );
}

// ─── Season Tab ───────────────────────────────────────────────────────────────
function SeasonTab({ venueData, venue }) {
  const lb = venueData?.leaderboard || [];
  const gameDates = venueData?.gameDates || [];
  const teams = venueData?.teams || [];

  const rankings = lb.length > 0 ? lb : (() => {
    const map = {};
    gameDates.forEach(gd => {
      gd.teams.forEach(t => {
        if (!map[t.name]) map[t.name] = { name: t.name, weeks: {}, total: 0 };
        const sc = totalFor(t.scores);
        map[t.name].weeks[gd.date] = sc;
        map[t.name].total += sc;
      });
    });
    if (!gameDates.length) teams.forEach(t => {
      if (!map[t.name]) map[t.name] = { name: t.name, weeks: {}, total: 0 };
      map[t.name].total += totalFor(t.scores);
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  })();

  const weekCols = lb.length > 0
    ? (lb[0] ? Object.keys(lb[0].weeks) : [])
    : gameDates.map(g => g.date);

  const leader = rankings[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        {[
          { label: "TEAMS",     value: rankings.length },
          { label: "LEADER",    value: leader?.name?.split(" ")[0] || "—", sm: true },
          { label: "TOP SCORE", value: leader?.total || "—" },
          { label: "WEEKS",     value: weekCols.length || gameDates.length },
        ].map(s => (
          <div key={s.label} style={{ background: "var(--s1)", border: "1px solid var(--br)", borderRadius: 8, padding: "16px 20px" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 2, marginBottom: 8 }}>{s.label}</div>
            <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: s.sm ? 18 : 28, color: "var(--g)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {rankings.length === 0 ? (
        <div style={{ background: "var(--s1)", border: "1px solid var(--br)", borderRadius: 8, padding: "44px 20px", textAlign: "center", fontFamily: "var(--mono)", fontSize: 11, color: "var(--mu)", letterSpacing: 1 }}>
          NO SEASON DATA — IMPORT AN EXCEL WORKBOOK OR ENTER SOME SCORES
        </div>
      ) : (
        <div style={{ background: "var(--s1)", border: "1px solid var(--br)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "11px 20px", borderBottom: "1px solid var(--br)", fontFamily: "var(--mono)", fontSize: 10, color: "var(--mu)", letterSpacing: 2 }}>
            SEASON STANDINGS — {venue.toUpperCase()}
            {lb.length > 0 && <span style={{ color: "var(--g)", marginLeft: 12 }}>← IMPORTED</span>}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 500 }}>
              <thead>
                <tr style={{ background: "var(--s2)" }}>
                  <th style={thSty({ width: 28 })}>#</th>
                  <th style={thSty({ textAlign: "left", paddingLeft: 12, minWidth: 160 })}>TEAM</th>
                  {weekCols.map(w => (
                    <th key={w} style={thSty({ minWidth: 72, fontSize: 9 })}>{w.toUpperCase()}</th>
                  ))}
                  <th style={thSty({ color: "var(--g)", minWidth: 76 })}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((r, idx) => (
                  <tr key={r.name} style={{
                    borderTop: "1px solid var(--br)",
                    background: idx === 0 ? "var(--gd)" : idx % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)",
                  }}>
                    <td style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: idx === 0 ? "var(--g)" : "var(--mu)", padding: "10px 4px" }}>
                      {idx + 1}
                    </td>
                    <td style={{ padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 13, color: "var(--t)", fontWeight: idx === 0 ? 700 : 400 }}>
                      {r.name}
                    </td>
                    {weekCols.map(w => (
                      <td key={w} style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 13, color: r.weeks[w] != null && r.weeks[w] !== "" ? "var(--t)" : "var(--mu)", padding: "10px 4px" }}>
                        {r.weeks[w] != null && r.weeks[w] !== "" ? r.weeks[w] : "—"}
                      </td>
                    ))}
                    <td style={{ textAlign: "center", fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700, color: idx === 0 ? "var(--g)" : "var(--t)", padding: "10px 8px" }}>
                      {r.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const iSty = {
  background: "var(--s2)", border: "1px solid var(--br)", borderRadius: 4,
  color: "var(--t)", fontFamily: "var(--mono)", fontSize: 13,
  padding: "8px 12px", outline: "none", transition: "border-color .1s",
};
const bSty = {
  background: "var(--gd)", border: "1px solid var(--gb)", borderRadius: 4,
  color: "var(--g)", fontFamily: "var(--mono)", fontSize: 11, fontWeight: 700,
  padding: "8px 18px", cursor: "pointer", letterSpacing: 1,
  transition: "all .15s", whiteSpace: "nowrap",
};
const thSty = (extra = {}) => ({
  padding: "9px 3px", fontFamily: "var(--mono)", fontSize: 10,
  fontWeight: 700, letterSpacing: 1.5, color: "var(--mu)",
  textAlign: "center", borderBottom: "1px solid var(--br)",
  ...extra,
});
