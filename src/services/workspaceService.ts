import * as fs from 'node:fs';
import * as path from 'node:path';
import { createInitialPlotDocument, serializePlotDocument } from '../core/serializer';
import { DEFAULT_PLOT_CONFIG, sanitizePlotConfig } from '../core/theme';
import { PlotConfig } from '../core/types';

export const NPLOT_CONFIG_FILE = '.nplot.json';

export interface NPlotWorkspaceManifest {
  version: 1;
  enabled: boolean;
  defaultPlotFile: string;
  config: PlotConfig;
}

export function isPlotFolderEnabledOnDisk(folderPath: string): boolean {
  const configPath = path.join(folderPath, NPLOT_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return false;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    return raw.enabled !== false;
  } catch {
    return false;
  }
}

export function enablePlotFolderOnDisk(
  folderPath: string,
  createSampleIfEmpty = true
): { manifestPath: string; samplePlotPath?: string } {
  const manifestPath = path.join(folderPath, NPLOT_CONFIG_FILE);
  let existingConfig = DEFAULT_PLOT_CONFIG;
  if (fs.existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      if (parsed.config && typeof parsed.config === 'object') {
        existingConfig = sanitizePlotConfig(parsed.config as Record<string, unknown>);
      }
    } catch {
      // ignore invalid manifest
    }
  }

  const manifest: NPlotWorkspaceManifest = {
    version: 1,
    enabled: true,
    defaultPlotFile: 'story.nplot',
    config: {
      ...existingConfig,
      enabled: true,
    },
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  let samplePlotPath: string | undefined;
  const existingPlots = fs
    .readdirSync(folderPath)
    .filter((f) => f.endsWith('.nplot'));

  if (createSampleIfEmpty && existingPlots.length === 0) {
    samplePlotPath = path.join(folderPath, 'story.nplot');
    const initialDoc = createInitialPlotDocument(path.basename(folderPath) + ' プロット');
    fs.writeFileSync(samplePlotPath, serializePlotDocument(initialDoc), 'utf8');
  }

  return { manifestPath, samplePlotPath };
}

export function disablePlotFolderOnDisk(folderPath: string): void {
  const manifestPath = path.join(folderPath, NPLOT_CONFIG_FILE);
  if (!fs.existsSync(manifestPath)) {
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    parsed.enabled = false;
    fs.writeFileSync(manifestPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  } catch {
    fs.unlinkSync(manifestPath);
  }
}
