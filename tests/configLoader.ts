import fs from 'fs';
import path from 'path';

function deepMerge(target: any, source: any): any {
    if (source && typeof source === 'object') {
        Object.keys(source).forEach(key => {
            if (source[key] && typeof source[key] === 'object') {
                if (!target[key]) {
                    target[key] = Array.isArray(source[key]) ? [] : {};
                }
                deepMerge(target[key], source[key]);
            } else {
                target[key] = source[key];
            }
        });
    }
    return target;
}


export const loadConfig = (commonConfigFile: string, specificConfigFile: string): any => {

    const commonConfigPath = commonConfigFile;
    const specificConfigPath = specificConfigFile;

    const commonConfig = JSON.parse(fs.readFileSync(commonConfigPath, 'utf8'));
    const specificConfig = JSON.parse(fs.readFileSync(specificConfigPath, 'utf8'));

    return deepMerge(commonConfig, specificConfig);
}


export const saveConfig = (filepath: string, data: object): void => {
    console.log(filepath)
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8'); // Pretty print with 2 spaces indentation
}