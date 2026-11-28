import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployJudgeSite } from '../scripts/deploy-judge-site.mjs';

const candidate = '1'.repeat(40);
const other = '2'.repeat(40);
const env = {
  SHA: candidate, SITE: 'https://site.example', HOOK: 'https://render.example/deploy?key=fixture',
  GITHUB_REPOSITORY: 'example/repo', GITHUB_API_URL: 'https://api.github.example', GITHUB_EVENT_NAME: 'workflow_run',
};

// Any unexpected request, including a deploy POST in the stale-run cases, fails the test.
function replay(responses, event = 'workflow_run') {
  const calls = [];
  async function request(target, options) {
    const url = new URL(target);
    url.searchParams.delete('nocache');
    const [, , body, status = 200] = responses[calls.length] ?? [];
    calls.push([options.method ?? 'GET', url.href]);
    return Response.json(body, { status });
  }
  return deployJudgeSite({ ...env, GITHUB_EVENT_NAME: event }, request, async () => {})
    .finally(() => assert.deepEqual(calls, responses.map(([method, url]) => [method, url])));
}
const version = (commit, status = 200) => ['GET', `${env.SITE}/version.json`, { commit }, status];
const compare = (status, code = 200) => ['GET', `${env.GITHUB_API_URL}/repos/example/repo/compare/${candidate}...${other}`, { status }, code];
const post = ['POST', `${env.HOOK}&ref=${candidate}`, {}];

test('an automatic run skips the hook when the exact commit or a descendant is live', async () => {
  assert.match(await replay([version(candidate)]), /Already live/);
  assert.match(await replay([version(other), compare('ahead')]), /Keeping newer/);
});

test('a forward deploy posts once and waits through transient responses for the exact SHA', async () => {
  assert.match(await replay([version(other), compare('behind'), post, version(null, 503), version(other), version(candidate)]), /Live at/);
});

test('unavailable or divergent ancestry and invalid live data fail before sending the hook', async () => {
  await assert.rejects(replay([version(other), compare('diverged')]), /Cannot order/);
  await assert.rejects(replay([version(other), compare(null, 503)]), /comparison returned HTTP 503/);
  await assert.rejects(replay([version(null, 502)]), /version returned HTTP 502/);
  await assert.rejects(replay([version('unknown')]), /no valid commit/);
});

test('first publication and an explicit manual redeploy still work', async () => {
  assert.match(await replay([version(null, 404), post, version(candidate)]), /Live at/);
  assert.match(await replay([post, version(candidate)], 'workflow_dispatch'), /Live at/);
});

test('once the hook is sent, serving another commit never satisfies the wait', async () => {
  await assert.rejects(replay([post, ...Array.from({ length: 60 }, () => version(other))], 'workflow_dispatch'), /did not go live/);
});
