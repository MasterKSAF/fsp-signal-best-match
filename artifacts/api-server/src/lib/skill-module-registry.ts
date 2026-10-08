// Public programme metadata; never imports or returns private oracle snapshots.
import { skillModuleRegistry as registry } from './skill-module-bank';
export const skillModuleRegistry = registry.map(m => ({ ...m, label: m.title }));
