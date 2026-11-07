// Code the page and the API both use, so they always agree. It's a plain script: the page loads it with
// <script src="/shared.js">, the API (lib/core.mjs) imports it, and either way it sets globalThis.SkittlersShared.
// Keep it free of anything that only exists in a browser or only on the server.
(function () {
  "use strict";

  /* ---------- knockout cups ---------- */
  // The order seeds go into a bracket of a given size, so byes are spread through the draw: 1 v 8, 4 v 5, 2 v 7, 3 v 6…
  function seedOrder(size) { let o = [1]; while (o.length < size) { const n = o.length * 2; o = o.flatMap(s => [s, n + 1 - s]); } return o; }
  const cupRoundCount = n => Math.max(1, Math.ceil(Math.log2(Math.max(2, n || 0))));
  function roundName(r, total) { const left = total - r; return left === 0 ? "Final" : left === 1 ? "Semi-finals" : left === 2 ? "Quarter-finals" : `Round ${r}`; }

  // Where an entry plays at home: its team's venue and alley. A player's entry id is "p:<team id>:<name>".
  function entrantHome(cup, id, teams, venues) {
    if (!id) return null;
    const team = cup.format === "team" ? teams[id] : teams[String(id).split(":")[1]], v = venues[team?.venue];
    return v ? { venue: v.id, alley: v.alleys > 1 ? (team.alley || 1) : null } : null;
  }
  // Who goes into a round of a cup drawn by hand: the winners of the round before, once all its results are in (else null).
  function cupEntering(prev) { return prev.every(m => m.empty || m.winner) ? prev.filter(m => !m.empty).map(m => m.winner) : null; }
  // The matches set by hand for a round, if they still fit who's going into it: every one of them used once, the rest of
  // the places empty. A round of one match between the last two needs no draw.
  function cupRoundPairs(cup, r, entering, slots) {
    if (!entering) return null;
    const p = cup.pairings?.[r];
    if (Array.isArray(p) && p.length === slots) {
      const used = p.flat().filter(Boolean), want = new Set(entering);
      if (used.length === want.size && new Set(used).size === used.length && used.every(x => want.has(x))) return p.map(x => [x?.[0] || null, x?.[1] || null]);
    }
    return slots === 1 && entering.length === 2 ? [[entering[0], entering[1]]] : entering.length < 2 ? [[entering[0] || null, null]] : null;
  }
  // Where a match is played: a venue chosen for it, else the semi-final and final rules set on the cup (neutral, chosen
  // later; or the final at a set alley), else the home side's alley.
  function cupVenue(cup, m, R, venues, home) {
    const sched = cup.schedule?.[m.id] || {}, fin = cup.finalAt || {};
    if (sched.venue && venues[sched.venue]) return { venue: sched.venue, alley: venues[sched.venue].alleys > 1 ? (sched.alley || 1) : null, chosen: true };
    if (m.round === R && fin.mode === "set" && venues[fin.venue]) return { venue: fin.venue, alley: venues[fin.venue].alleys > 1 ? (fin.alley || 1) : null, set: true };
    if ((m.round === R && (fin.mode === "neutral" || fin.mode === "set")) || (R > 1 && m.round === R - 1 && cup.semiVenue === "neutral")) return { venue: null, alley: null, neutral: true };
    return { venue: home?.venue || null, alley: home?.alley || null };
  }

  // Every round of a knockout cup, worked out from the draw and the results saved so far. Only the draw and results are
  // stored: winners move through automatically, and a result is ignored if an earlier result changed who's playing.
  // Places beyond the entries drawn are byes; a match with nobody in it is "empty", and whoever would have met its
  // winner gets a bye. A cup drawn by hand (drawMode "manual") takes each later round's matches from cup.pairings once
  // the round before is finished. Each match: { id, round, slot, a, b, aPins, bPins, winner, bye, empty, tie, cards,
  // toDraw, couldA, couldB, date, time, venue, alley, venueChosen, venueSet, neutral, clash }, where couldA and couldB
  // list who could still be in each place while earlier results are awaited, and clash marks two matches of a round
  // on the same venue and alley.
  function cupRounds(cup, teams = {}, venues = {}) {
    const R = cupRoundCount(cup.entries), size = 2 ** R, order = seedOrder(size), draw = cup.draw || [], n = draw.length, manual = cup.drawMode === "manual";
    const rounds = []; let prev = null;
    for (let r = 1; r <= R; r++) {
      const matches = [], when = cup.roundDates?.[r] || {}, slots = size / 2 ** r;
      const entering = r > 1 && manual ? cupEntering(prev) : null, pairs = r > 1 && manual ? cupRoundPairs(cup, r, entering, slots) : null;
      for (let k = 0; k < slots; k++) {
        const id = `${r}-${k}`, m = { id, round: r, slot: k, a: null, b: null, aPins: null, bPins: null, winner: null, bye: false, empty: false, tie: false, cards: null, toDraw: false };
        if (r === 1) {
          const sa = order[2 * k], sb = order[2 * k + 1];
          m.a = draw[sa - 1] || null; m.b = draw[sb - 1] || null;
          if (sa > n && sb > n) m.empty = true;
          else if (sa > n || sb > n) { m.bye = true; m.winner = m.a || m.b; }
        } else if (manual) {
          if (!pairs) m.toDraw = !!entering;
          else { [m.a, m.b] = pairs[k] || [null, null];
            if (!m.a && !m.b) m.empty = true; else if (!m.a || !m.b) { m.a = m.a || m.b; m.b = null; m.bye = true; m.winner = m.a; } }
        } else {
          const pa = prev[2 * k], pb = prev[2 * k + 1];
          if (pa.empty && pb.empty) m.empty = true;
          else if (pa.empty || pb.empty) { m.bye = true; m.a = (pa.empty ? pb : pa).winner; m.winner = m.a; }
          else { m.a = pa.winner; m.b = pb.winner; }
        }
        // Who could still be in each place, for a match waiting on earlier results.
        const could = (x, feeder) => x ? [x] : feeder ? (feeder.winner ? [feeder.winner] : [...feeder.couldA, ...feeder.couldB]) : [];
        if (r === 1 || manual) { m.couldA = m.a ? [m.a] : []; m.couldB = m.b ? [m.b] : []; }
        else { const pa = prev[2 * k], pb = prev[2 * k + 1]; m.couldA = m.bye ? could(m.a, pa.empty ? pb : pa) : could(m.a, pa); m.couldB = m.bye ? [] : could(m.b, pb); }
        const res = cup.results?.[id];
        if (!m.bye && !m.empty && res && m.a && m.b && res.a === m.a && res.b === m.b && Number.isFinite(res.aPins) && Number.isFinite(res.bPins)) {
          m.aPins = res.aPins; m.bPins = res.bPins; m.cards = res.cards || null;
          m.tie = res.aPins === res.bPins;
          m.winner = m.tie ? ([m.a, m.b].includes(res.winner) ? res.winner : null) : (res.aPins > res.bPins ? m.a : m.b);
        }
        m.date = when.date || ""; m.time = when.time || "";
        const at = cupVenue(cup, m, R, venues, entrantHome(cup, m.a, teams, venues));
        Object.assign(m, { venue: at.venue, alley: at.alley, venueChosen: !!at.chosen, venueSet: !!at.set, neutral: !!at.neutral, clash: false });
        matches.push(m);
      }
      // A round's matches are played on the same night, so flag any that share a venue and alley.
      const byKey = {};
      for (const m of matches) if (!m.bye && !m.empty && m.a && m.b && m.venue) (byKey[`${m.venue}|${m.alley || 1}`] ||= []).push(m);
      for (const list of Object.values(byKey)) if (list.length > 1) list.forEach(m => m.clash = true);
      rounds.push({ r, name: roundName(r, R), date: when.date || "", time: when.time || "", matches, toDraw: matches.some(m => m.toDraw), entering });
      prev = matches;
    }
    return { R, rounds, champion: rounds.at(-1).matches[0].winner };
  }

  globalThis.SkittlersShared = { seedOrder, cupRoundCount, roundName, entrantHome, cupEntering, cupRoundPairs, cupVenue, cupRounds };
})();
