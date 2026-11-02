// Asks Claude to read a scoreboard photo or write a match night report (live site and local server only; the
// preview uses the Claude app instead).
// Needs ANTHROPIC_API_KEY in Netlify's environment variables. BOARD_MODEL and BOARD_EFFORT can change the model
// and how carefully it reads; the defaults suit a chalkboard photo.
import Anthropic from "@anthropic-ai/sdk";

export function claudeReader({ apiKey = process.env.ANTHROPIC_API_KEY, model = process.env.BOARD_MODEL || "claude-opus-5-5", effort = process.env.BOARD_EFFORT || "medium" } = {}) {
  // For trying the site locally without a key: BOARD_FAKE=1 makes up a plausible reading after a short wait.
  if (process.env.BOARD_FAKE === "1") return fakeReader;
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 4 * 60 * 1000, maxRetries: 2 });
  return async function read({ images, prompt, schema }) {
    const photo = images.length > 0;
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        // If this model declines, the API retries on a suitable model in the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort, format: { type: "json_schema", schema } },
        messages: [{
          role: "user",
          content: [
            ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } })),
            { type: "text", text: prompt },
          ],
        }],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new Error("Claude isn't set up properly on the site: the API key was refused.");
      if (e instanceof Anthropic.RateLimitError) throw new Error("Claude is busy right now. Try again in a minute.");
      if (e instanceof Anthropic.BadRequestError) throw new Error(photo ? "That photo couldn't be read. Try another photo." : "The report couldn't be written from this night's results.");
      if (e instanceof Anthropic.APIError) throw new Error("Claude isn't available right now. Try again in a minute.");
      throw new Error("Claude couldn't be reached. Try again in a minute.");
    }
    if (response.stop_reason === "refusal") throw new Error(photo ? "This photo couldn't be read." : "The report couldn't be written.");
    if (response.stop_reason === "max_tokens") throw new Error(photo ? "There was too much on the board to read in one go." : "The report ran too long. Try again.");
    const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    try { return JSON.parse(text); } catch { throw new Error(`The ${photo ? "reading" : "report"} came back in the wrong shape. Try again.`); }
  };
}

// Local testing only: rows for the first few players of each team, with random scores.
async function fakeReader({ prompt, schema }) {
  await new Promise(r => setTimeout(r, 1500));
  if (schema?.required?.[0] === "title") {
    const facts = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.indexOf("\n\nWrite the report")));
    return { title: `Made-up report: ${facts.matchNight}`, body: `${facts.results.length} games were played.\n\n` + facts.results.map(r => `${r.home} ${r.homePins}, ${r.away} ${r.awayPins}.`).join(" ") + "\n\nThis is a made-up report for local testing." };
  }
  const teams = [...prompt.matchAll(/^Team (\d+): .*\nPlayers \(key \| name \| nickname\):\n((?:.+\n?)*?)(?:\n|$)/gm)];
  const hands = Number(/throws (\d+) hand/.exec(prompt)?.[1] || 6);
  return {
    teams: teams.map(([, i, list]) => ({
      team: Number(i), handTotals: [], writtenTotal: -1,
      rows: list.trim().split("\n").filter(l => l.includes(" | ")).slice(0, 6).map((l, r) => {
        const [key, name] = l.split(" | "), scores = Array.from({ length: hands }, () => 3 + Math.floor(Math.random() * 7));
        if (r === 1) scores[1] = 12;
        return { boardName: name.split(" ")[0], playerKey: r === 2 ? "" : key, hands: scores, spares: scores.map(v => v >= 10), unsure: r === 0 ? [3] : [], writtenTotal: scores.reduce((a, b) => a + b, 0) };
      }),
    })),
    notes: "Made-up reading for local testing.",
  };
}
