import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIR = path.resolve(__dirname, '..', 'skills');

// In-memory cache of parsed skills
let loadedSkills = null;

function parseYamlFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const rawYaml = match[1];
  const body = match[2];
  const meta = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentKey = null;
  let currentList = null;
  let currentListItemObj = null;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    // List item of commands
    if (trimmed.startsWith('- command:')) {
      if (!meta.commands) meta.commands = [];
      const cmdVal = trimmed.replace('- command:', '').trim().replace(/^['"]|['"]$/g, '');
      currentListItemObj = { command: cmdVal };
      meta.commands.push(currentListItemObj);
      return;
    }

    if (currentListItemObj && trimmed.startsWith('description:')) {
      currentListItemObj.description = trimmed.replace('description:', '').trim().replace(/^['"]|['"]$/g, '');
      return;
    }

    if (currentListItemObj && trimmed.startsWith('example:')) {
      currentListItemObj.example = trimmed.replace('example:', '').trim().replace(/^['"]|['"]$/g, '');
      return;
    }

    // List item (e.g. tools)
    if (trimmed.startsWith('- ') && currentKey) {
      const val = trimmed.replace('- ', '').trim().replace(/^['"]|['"]$/g, '');
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(val);
      return;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx > -1) {
      currentListItemObj = null;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      currentKey = key;
      if (value) {
        meta[key] = value;
      }
    }
  });

  return { meta, body };
}

export const skillService = {
  getSkills() {
    if (loadedSkills) return loadedSkills;

    const skills = [];
    if (!fs.existsSync(SKILLS_DIR)) return [];

    const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const skillFile = path.join(SKILLS_DIR, dir.name, 'SKILL.md');
      if (fs.existsSync(skillFile)) {
        try {
          const raw = fs.readFileSync(skillFile, 'utf8');
          const { meta, body } = parseYamlFrontmatter(raw);
          skills.push({
            id: dir.name,
            name: meta.name || dir.name,
            displayName: meta.displayName || meta.name || dir.name,
            role: meta.role || 'all',
            description: meta.description || '',
            commands: meta.commands || [],
            tools: meta.tools || [],
            instructions: body.trim()
          });
        } catch (err) {
          console.error(`[Skills] Failed to load skill ${dir.name}:`, err.message);
        }
      }
    }

    loadedSkills = skills;
    return loadedSkills;
  },

  // Get skills filtered by user role
  getSkillsForUser(role = 'user') {
    const userRole = (role || 'user').toLowerCase();
    const all = this.getSkills();

    // Admins have access to all skills
    if (userRole === 'admin') return all;

    return all.filter(s => {
      const target = (s.role || 'all').toLowerCase();
      if (target === 'all') return true;
      if (target === userRole) return true;
      // Executives can view manager & engineer skills
      if (userRole === 'executive' && ['manager', 'engineer', 'client'].includes(target)) return true;
      // Managers can view engineer & technician skills
      if (userRole === 'manager' && ['engineer', 'technician', 'client'].includes(target)) return true;
      return false;
    });
  },

  // Match slash command or keyword to skill
  findMatchingSkill(input = '') {
    const trimmed = input.trim().toLowerCase();
    const all = this.getSkills();

    for (const skill of all) {
      if (Array.isArray(skill.commands)) {
        for (const cmdObj of skill.commands) {
          const cmd = (cmdObj.command || '').toLowerCase();
          if (trimmed === cmd || trimmed.startsWith(`${cmd} `)) {
            return {
              skill,
              command: cmdObj,
              matchedQuery: trimmed.replace(cmd, '').trim()
            };
          }
        }
      }
    }
    return null;
  }
};
