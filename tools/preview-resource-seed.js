'use strict';

const fs = require('fs');
const path = require('path');

const seedPath = path.resolve(__dirname, '..', 'cloudfunctions', 'adminSubmissions', 'data', 'resources.v1.json');
const resources = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const allowedTypes = new Set(['landmark', 'hotspot', 'activity', 'article', 'experience', 'route']);
const ids = new Set();
const aliases = new Set();
const errors = [];

for (const [index, resource] of resources.entries()) {
  const label = `resources[${index}]`;
  if (!/^[A-Za-z0-9_-]+$/.test(resource.id || '')) errors.push(`${label}: invalid id`);
  if (ids.has(resource.id)) errors.push(`${label}: duplicate id ${resource.id}`);
  ids.add(resource.id);
  if (!allowedTypes.has(resource.type)) errors.push(`${label}: invalid type ${resource.type}`);
  if (!resource.title || !resource.summary) errors.push(`${label}: title and summary are required`);
  if (resource.status !== 'published') errors.push(`${label}: v1 seed only accepts published resources`);
  if (!Array.isArray(resource.categoryIds) || !Array.isArray(resource.tags)) {
    errors.push(`${label}: categoryIds and tags must be arrays`);
  }
  if (!resource.capabilities || typeof resource.capabilities.commentable !== 'boolean') {
    errors.push(`${label}: capabilities.commentable is required`);
  }
  for (const alias of resource.legacyAliases || []) {
    const aliasKey = `${alias.type}:${alias.id}`;
    if (!alias.type || !/^[A-Za-z0-9_-]+$/.test(alias.id || '')) {
      errors.push(`${label}: invalid legacy alias`);
    } else if (aliases.has(aliasKey)) {
      errors.push(`${label}: duplicate legacy alias ${aliasKey}`);
    }
    aliases.add(aliasKey);
  }
}

for (const resource of resources) {
  for (const relatedId of resource.relatedResourceIds || []) {
    if (!ids.has(relatedId)) errors.push(`${resource.id}: unknown related resource ${relatedId}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const typeCounts = resources.reduce((counts, resource) => {
  counts[resource.type] = (counts[resource.type] || 0) + 1;
  return counts;
}, {});

console.log('Resource seed preview (read-only)');
console.log(`Source: ${seedPath}`);
console.log(`Resources: ${resources.length}`);
console.log(`Legacy aliases: ${aliases.size}`);
Object.keys(typeCounts).sort().forEach((type) => console.log(`- ${type}: ${typeCounts[type]}`));
console.log('No CloudBase data was written, updated, or deleted.');

