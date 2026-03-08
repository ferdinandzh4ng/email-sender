import { createClient } from '@supabase/supabase-js';

const BUCKET = 'attachments';

let client;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for file storage.');
    client = createClient(url, key);
  }
  return client;
}

export async function uploadAttachment(key, buffer) {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(BUCKET).upload(key, buffer, {
    contentType: 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error('Supabase upload failed: ' + error.message);
  return key;
}

export async function downloadAttachment(key) {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error('Supabase download failed: ' + (error?.message || 'no data'));
  return Buffer.from(await data.arrayBuffer());
}

export function hasStorage() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
