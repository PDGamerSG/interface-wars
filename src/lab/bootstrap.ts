// Creates the lab's admin user and the experiment "control" organisation on a fresh self-hosted Flagsmith.
// The control organisation holds the agent_interface experiment. Agents never receive its credentials:
// every trial runs in its own sandbox organisation with its own master API key.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { anonymousPost, createAdmin } from '../flagsmith/admin.ts';
import { FLAGSMITH_URL, LAB_FILE, readLab, writeLab, type Lab } from './config.ts';

async function waitForFlagsmith() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(FLAGSMITH_URL + '/health/liveness/');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Flagsmith did not become healthy at ' + FLAGSMITH_URL);
}

export async function bootstrap(): Promise<Lab> {
  await waitForFlagsmith();
  if (existsSync(LAB_FILE)) {
    const lab = readLab();
    const admin = createAdmin(FLAGSMITH_URL, { kind: 'token', value: lab.admin.token });
    try {
      await admin.get(`/api/v1/organisations/${lab.control.organisationId}/`);
      return lab;
    } catch {
      console.log('Existing lab file does not match this Flagsmith instance; bootstrapping again.');
    }
  }

  const email = 'lab@interface-wars.test';
  const password = randomBytes(18).toString('base64url') + 'A1!';
  const user = await anonymousPost(FLAGSMITH_URL, '/api/v1/auth/users/', {
    email, password, re_password: password, first_name: 'Interface', last_name: 'Wars',
  });
  const token: string = user.key;
  const admin = createAdmin(FLAGSMITH_URL, { kind: 'token', value: token });

  const org = await admin.post('/api/v1/organisations/', { name: 'Interface Wars Control' });
  const project = await admin.post('/api/v1/projects/', { name: 'interface-wars', organisation: org.id });
  const env = await admin.post('/api/v1/environments/', { name: 'Trials', project: project.id });
  await admin.post(`/api/v1/environments/${env.api_key}/warehouse-connections/`, {
    warehouse_type: 'postgres', name: 'Flagsmith database', config: { source: 'flagsmith_database' },
  });
  const serverKey = await admin.post(`/api/v1/environments/${env.api_key}/api-keys/`, { name: 'trial-runner' });
  const master = await admin.post(`/api/v1/organisations/${org.id}/master-api-keys/`, { name: 'control-plane', is_admin: true });

  const lab: Lab = {
    admin: { email, password, token },
    control: {
      organisationId: org.id,
      projectId: project.id,
      environmentKey: env.api_key,
      environmentId: env.id,
      serverKey: serverKey.key,
      masterKey: master.key,
    },
  };
  writeLab(lab);
  return lab;
}

if (import.meta.main) {
  const lab = await bootstrap();
  console.log(JSON.stringify({ organisation: lab.control.organisationId, project: lab.control.projectId, environment: lab.control.environmentKey }, null, 2));
}
