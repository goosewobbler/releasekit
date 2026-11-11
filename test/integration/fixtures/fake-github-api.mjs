// Preloaded with `node --import` so the CLI's real GitHub adapter talks to a fake API instead of api.github.com.
// RK_FAKE_GITHUB is JSON: { prs: [{ number, sha, labels }] }.
const { prs } = JSON.parse(process.env.RK_FAKE_GITHUB ?? '{"prs":[]}');
const realFetch = globalThis.fetch;

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== 'api.github.com') {
    return realFetch(input, init);
  }

  const commitPulls = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/pulls$/);
  if (commitPulls) {
    const merged = prs.filter((pr) => pr.sha === commitPulls[1]);
    return json(
      200,
      merged.map((pr) => ({ number: pr.number, merged_at: '2026-01-01T00:00:00Z' })),
    );
  }

  const issue = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)(\/comments)?$/);
  const pr = issue && prs.find((p) => p.number === Number(issue[1]));
  if (pr) {
    return issue[2]
      ? json(200, [])
      : json(200, {
          number: pr.number,
          title: `PR ${pr.number}`,
          body: '',
          labels: pr.labels.map((name) => ({ name })),
          pull_request: {},
        });
  }

  return json(404, { message: 'Not Found' });
};
