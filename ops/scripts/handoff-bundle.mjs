import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const format = 'miningqwq-handoff-v1';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
function outsideRepository(file) {
  if (inside(fs.realpathSync(repository), fs.realpathSync(file))) throw Error('PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY');
}
function keyBytes(file) {
  outsideRepository(file);
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(text)) throw Error('HANDOFF_KEY_MUST_BE_32_RANDOM_BYTES_AS_HEX');
  return Buffer.from(text, 'hex');
}
export function packHandoff({files, keyFile, output}) {
  if (!files.length || files.length > 10) throw Error('HANDOFF_REQUIRES_1_TO_10_FILES');
  for (const file of files) outsideRepository(file);
  fs.mkdirSync(path.dirname(keyFile), {recursive: true});
  outsideRepository(path.dirname(keyFile));
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex') + '\n', {flag: 'wx', mode: 0o600});
  const key = keyBytes(keyFile);
  const names = files.map(file => path.basename(file));
  if (new Set(names).size !== names.length) throw Error('DUPLICATE_HANDOFF_FILENAMES');
  const payload = {files: files.map(file => {
    const data = fs.readFileSync(file);
    if (data.length > 1024 * 1024) throw Error('HANDOFF_FILE_TOO_LARGE');
    return {name: path.basename(file), sha256: hash(data), data: data.toString('base64')};
  })};
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(format));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const bundle = {format, algorithm: 'AES-256-GCM', iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url')};
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(bundle, null, 2) + '\n', {flag: 'wx'});
  return {files: names, encrypted: true};
}
export function unpackHandoff({bundleFile, keyFile, outputDirectory}) {
  const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
  if (bundle.format !== format || bundle.algorithm !== 'AES-256-GCM') throw Error('HANDOFF_FORMAT_UNSUPPORTED');
  const iv = Buffer.from(bundle.iv, 'base64url'), tag = Buffer.from(bundle.tag, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw Error('HANDOFF_FORMAT_INVALID');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(keyFile), iv);
  decipher.setAAD(Buffer.from(format)); decipher.setAuthTag(tag);
  const data = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, 'base64url')), decipher.final()]);
  const payload = JSON.parse(data.toString('utf8'));
  if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 10) throw Error('HANDOFF_FILES_INVALID');
  const files = payload.files.map(file => {
    if (typeof file.name !== 'string' || !file.name || /[\\/]/.test(file.name) || ['.', '..'].includes(file.name) ||
      path.isAbsolute(file.name) || /[:\0]/.test(file.name)) throw Error('HANDOFF_FILENAME_INVALID');
    const contents = Buffer.from(file.data, 'base64');
    if (hash(contents) !== file.sha256) throw Error('HANDOFF_DIGEST_MISMATCH');
    return {name: file.name, contents};
  });
  if (new Set(files.map(file => file.name)).size !== files.length) throw Error('DUPLICATE_HANDOFF_FILENAMES');
  // Do not put decrypted answers in a checkout, even if it has ignore rules.
  if (inside(repository, path.resolve(outputDirectory))) throw Error('PRIVATE_PATH_MUST_BE_OUTSIDE_REPOSITORY');
  fs.mkdirSync(outputDirectory, {recursive: true}); outsideRepository(outputDirectory);
  for (const file of files) if (fs.existsSync(path.join(outputDirectory, file.name))) throw Error('HANDOFF_OUTPUT_ALREADY_EXISTS');
  for (const file of files) fs.writeFileSync(path.join(outputDirectory, file.name), file.contents, {flag: 'wx', mode: 0o600});
  return {files: files.map(file => file.name), verified: true};
}
function argumentList(args) {
  const values = {}, files = [];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!value || value.startsWith('--') || !['--file', '--key-file', '--output', '--bundle', '--output-dir'].includes(key)) throw Error('HANDOFF_ARGUMENT_INVALID');
    if (key === '--file') files.push(path.resolve(value));
    else {
      if (values[key]) throw Error('HANDOFF_ARGUMENT_DUPLICATE');
      values[key] = path.resolve(value);
    }
  }
  return {values, files};
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [action, ...args] = process.argv.slice(2), {values, files} = argumentList(args);
    let result;
    if (action === 'pack' && values['--key-file'] && values['--output'] && !values['--bundle'] && !values['--output-dir']) {
      result = packHandoff({files, keyFile: values['--key-file'], output: values['--output']});
    } else if (action === 'unpack' && values['--key-file'] && values['--bundle'] && values['--output-dir'] && !files.length && !values['--output']) {
      result = unpackHandoff({bundleFile: values['--bundle'], keyFile: values['--key-file'], outputDirectory: values['--output-dir']});
    } else throw Error('HANDOFF_ARGUMENT_INVALID');
    console.log(JSON.stringify(result));
  } catch {
    // Input files and crypto errors may contain private material. Do not echo them.
    console.error('HANDOFF_BUNDLE_FAILED: check arguments, key file, authentication and output paths.');
    process.exitCode = 1;
  }
}
