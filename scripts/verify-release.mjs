import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const expectedPermissions = ["tabs", "tabGroups", "storage", "sidePanel"];
const expectedOptionalHosts = ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"];
const iconSizes = [16, 32, 48, 128];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await readFile(path.join(root, file), "utf8"));
}

async function pngDimensions(file) {
  const buffer = await readFile(path.join(root, file));
  const signature = "89504e470d0a1a0a";
  assert(buffer.subarray(0, 8).toString("hex") === signature, `${file} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25]
  };
}

async function assertOutputHygiene(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true, recursive: true });
  const sourceMap = entries.find((entry) => entry.isFile() && entry.name.endsWith(".map"));
  assert(!sourceMap, `${directory} contains a source map: ${sourceMap?.name}`);
  const editableMaster = entries.find((entry) => entry.isFile() && entry.name === "panekeep-master.svg");
  assert(!editableMaster, `${directory} contains the editable icon master`);
}

const packageJson = await readJson("package.json");
assert(packageJson.name === "panekeep", "package name must be panekeep");
assert(packageJson.license === "Apache-2.0", "package license must be Apache-2.0");

for (const browser of ["chrome", "edge"]) {
  const outputDirectory = `.output/${browser}-mv3`;
  const manifest = await readJson(`${outputDirectory}/manifest.json`);
  assert(manifest.manifest_version === 3, `${browser} manifest must use MV3`);
  assert(manifest.version === packageJson.version, `${browser} version must match package.json`);
  assert(manifest.name === "__MSG_extensionName__", `${browser} name must be localized`);
  assert(JSON.stringify(manifest.permissions) === JSON.stringify(expectedPermissions), `${browser} permissions changed without release review`);
  assert(JSON.stringify(manifest.optional_host_permissions) === JSON.stringify(expectedOptionalHosts), `${browser} optional hosts changed without release review`);
  for (const size of iconSizes) {
    assert(manifest.icons?.[size] === `icons/icon-${size}.png`, `${browser} manifest is missing the ${size}px icon`);
  }
  assert(manifest.action?.default_icon?.[16] === "icons/icon-16.png", `${browser} toolbar icon is missing`);
  assert(manifest.action?.default_icon?.[32] === "icons/icon-32.png", `${browser} high-density toolbar icon is missing`);
  for (const locale of ["en", "zh_CN"]) {
    const messages = await readJson(`${outputDirectory}/_locales/${locale}/messages.json`);
    assert(messages.extensionName?.message === "PaneKeep", `${browser}/${locale} extension name is stale`);
    assert(Boolean(messages.extensionDescription?.message), `${browser}/${locale} description is missing`);
  }
  await assertOutputHygiene(outputDirectory);
}

for (const size of iconSizes) {
  const file = `public/icons/icon-${size}.png`;
  const image = await pngDimensions(file);
  assert(image.width === size && image.height === size, `${file} must be ${size}x${size}`);
  assert(image.colorType === 4 || image.colorType === 6, `${file} must preserve an alpha channel`);
}

for (const locale of ["en", "zh-CN"]) {
  const file = `store-assets/promo-small-${locale}.png`;
  const image = await pngDimensions(file);
  assert(image.width === 440 && image.height === 280, `${file} must be 440x280`);
}

console.log(`PaneKeep ${packageJson.version} release assets verified for Chrome and Edge.`);
