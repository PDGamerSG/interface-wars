import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function deployJudgeSite(env, request = fetch, wait = sleep) {
  const { SHA: sha, SITE: site } = env;
  async function liveCommit() {
    const response = await request(`${site}/version.json?nocache=${Date.now()}`, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null; // A first publication can precede version.json.
    if (!response.ok) throw new Error(`Live version returned HTTP ${response.status}.`);
    const { commit } = await response.json();
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('Live version.json has no valid commit.');
    return commit;
  }

  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    const live = await liveCommit();
    if (live === sha) return `Already live at ${sha}.`;
    if (live) {
      const response = await request(`${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/compare/${sha}...${live}`, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}` }, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub commit comparison returned HTTP ${response.status}.`);
      const { status } = await response.json();
      if (status === 'ahead') return `Keeping newer live commit ${live}, which includes ${sha}.`;
      if (status !== 'behind') throw new Error(`Cannot order candidate ${sha} and live commit ${live} (${status}).`);
    }
  }

  if (!env.HOOK || !URL.canParse(env.HOOK)) throw new Error('RENDER_DEPLOY_HOOK is missing or invalid.');
  const hook = new URL(env.HOOK);
  hook.searchParams.set('ref', sha);
  let deploy;
  try {
    deploy = await request(hook, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error('Could not reach the Render deploy hook.');
  }
  if (!deploy.ok) throw new Error(`Render rejected the deploy with HTTP ${deploy.status}.`);

  let live;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (attempt) await wait(10_000);
    live = await liveCommit().catch(() => null);
    if (live === sha) return `Live at ${sha}.`;
  }
  throw new Error(`Release ${sha} did not go live after 60 checks. Last observed commit: ${live ?? 'unavailable'}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await deployJudgeSite(process.env));
}
