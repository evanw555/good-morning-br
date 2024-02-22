import { loadJson } from "evanw555.js";
import { GoodMorningAuth, GoodMorningConfig } from "./types";

const AUTH: GoodMorningAuth = loadJson('config/auth.json');
const CONFIG: GoodMorningConfig = loadJson('config/config.json');
// For local testing, load a config override file to override specific properties
try {
    const configOverride: Record<string, any> = loadJson('config/config-override.json');
    for (const key of Object.keys(configOverride)) {
        CONFIG[key] = configOverride[key];
        console.log(`Loaded overridden ${key} config property: ${JSON.stringify(configOverride[key])}`);
    }
} catch (err) {}

export { CONFIG, AUTH };
