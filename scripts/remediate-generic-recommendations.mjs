#!/usr/bin/env node
/**
 * remediate-generic-recommendations.mjs
 *
 * One-off admin remediation: update auto-generated RE recommendations that
 * still contain old generic fallback wording with the new module-specific text.
 *
 * ── Safety rules ──────────────────────────────────────────────────────────────
 *  • Only touches rows where source_type = 'auto'.
 *  • Only touches rows whose hazard_text exactly matches the old constant
 *    generic signature — manually edited recommendations will never match it.
 *  • Preserved fields: status, priority, target_date, evidence, photos,
 *    attachments, created_at, metadata, history, and every other column.
 *  • Only updates: title, observation_text, action_required_text, hazard_text.
 *  • The UPDATE WHERE clause includes both the hazard_text signature check and
 *    source_type = 'auto', so a concurrent manual edit cannot be overwritten.
 *  • Default mode is DRY RUN — no writes, just a report.
 *  • Writes require an explicit --apply flag.
 *
 * ── Requirements ──────────────────────────────────────────────────────────────
 *  • Node 20.6+ (--env-file flag used below)
 *  • SUPABASE_SERVICE_ROLE_KEY in .env (preferred for cross-doc admin access)
 *    Falls back to VITE_SUPABASE_ANON_KEY with a warning.
 *  • @supabase/supabase-js (already a project dependency)
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *  # Dry run — list all affected rows, write nothing:
 *  node --env-file=.env scripts/remediate-generic-recommendations.mjs
 *
 *  # Dry run scoped to one document (recommended before full run):
 *  node --env-file=.env scripts/remediate-generic-recommendations.mjs \
 *    --document-id=<uuid>
 *
 *  # Apply all changes:
 *  node --env-file=.env scripts/remediate-generic-recommendations.mjs --apply
 *
 *  # Apply scoped to one document:
 *  node --env-file=.env scripts/remediate-generic-recommendations.mjs \
 *    --document-id=<uuid> --apply
 */

import { createClient } from '@supabase/supabase-js';

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const docIdArg = args.find(a => a.startsWith('--document-id='));
const FILTER_DOC_ID = docIdArg ? docIdArg.split('=')[1].trim() : null;

// ─── Supabase client ──────────────────────────────────────────────────────────

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error('ERROR: VITE_SUPABASE_URL is not set. Run with --env-file=.env');
  process.exit(1);
}
const apiKey = serviceRoleKey || anonKey;
if (!apiKey) {
  console.error('ERROR: Neither SUPABASE_SERVICE_ROLE_KEY nor VITE_SUPABASE_ANON_KEY is set.');
  process.exit(1);
}
if (!serviceRoleKey) {
  console.warn(
    '\nWARNING: SUPABASE_SERVICE_ROLE_KEY not found — using anon key.\n' +
    '         RLS may prevent cross-document updates. Prefer service role key.\n',
  );
}

const supabase = createClient(supabaseUrl, apiKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Old wording signatures (mirrors remediationMap.ts) ───────────────────────
//
// The old buildFallbackContent() (before 2026-06-09) emitted an identical
// hazard_text for every generic recommendation, regardless of factor key.
// It also had a predictable action_required_text prefix.

const OLD_GENERIC_HAZARD_TEXT =
  'Inadequate controls increase the likelihood of loss events escalating beyond planned defenses. ' +
  'A foreseeable incident could develop faster than current safeguards allow, increasing damage extent and recovery time. ' +
  'Strengthening this control reduces overall facility risk profile.';

const OLD_GENERIC_ACTION_PREFIX = 'Review and implement improvements to bring ';

function isOldGenericWording(row) {
  if (row.hazard_text === OLD_GENERIC_HAZARD_TEXT) return true;
  if (row.action_required_text?.startsWith(OLD_GENERIC_ACTION_PREFIX)) return true;
  return false;
}

// ─── New wording map ──────────────────────────────────────────────────────────
//
// Mirrors FACTOR_SPECIFIC_FALLBACKS in recommendationPipeline.ts.
// Only the non-RE06 entries (module-level and HRG occupancy drivers) are needed
// here because RE06-specific entries had targeted wording in the old code too,
// and are unlikely to have hit the generic path.  They are included as a safety
// net.

const WORDING_MAP = {
  // ── Module-level ──────────────────────────────────────────────────────────
  RE_02_CONSTRUCTION: {
    title: 'Improve construction standard to reduce fire and loss escalation potential',
    observation_text: 'The assessed construction standard presents elevated fire spread or structural collapse potential under foreseeable incident conditions.',
    action_required_text: 'Commission a construction fire risk review focusing on frame type, compartmentation, roof/cladding combustibility, and openings. Implement identified improvements with prioritised actions and accountable owners.',
    hazard_text: 'Sub-standard construction can allow rapid structural failure and fire spread to adjacent areas, materially increasing property and business interruption loss severity.',
  },
  RE_03_OCCUPANCY: {
    title: 'Reduce occupancy fire load and hazard exposure',
    observation_text: 'The assessed occupancy and process activities present a fire load or hazard profile that is not adequately controlled.',
    action_required_text: 'Review and reduce fire load concentrations, assess process hazards, and implement targeted controls. Document corrective measures with named owners and target dates.',
    hazard_text: 'Elevated fire load and uncontrolled process hazards increase ignition likelihood and can allow rapid fire development beyond the capacity of installed protection.',
  },
  RE_07_NATURAL_HAZARDS: {
    title: 'Strengthen natural hazard resilience and exposure controls',
    observation_text: "The site's natural hazard exposure is not adequately mitigated by current controls. Resilience measures are insufficient for the identified hazard profile.",
    action_required_text: 'Conduct a targeted natural hazard exposure assessment covering flood, wind, seismic, and subsidence risk as applicable. Implement physical and operational resilience measures with a named accountable owner and target completion date.',
    hazard_text: 'Inadequate natural hazard controls can result in unplanned asset damage, extended business interruption, and compounded loss from concurrent incidents affecting the site.',
  },
  RE_08_UTILITIES: {
    title: 'Improve utility reliability and backup arrangements',
    observation_text: 'Utility supply reliability and backup resilience are not sufficient for the operational and safety demands of the site.',
    action_required_text: 'Review primary utility dependencies, backup power provision, and automatic changeover capability. Implement reliability improvements and formally document emergency utility response procedures.',
    hazard_text: 'Utility failure during fire or incident conditions can remove critical safety and suppression systems, materially increasing loss severity and recovery time.',
  },
  RE_09_MANAGEMENT: {
    title: 'Strengthen risk management systems and loss-prevention controls',
    observation_text: 'Risk management systems and loss-prevention controls are assessed below the acceptable engineering standard. Current arrangements do not provide sufficient assurance that hazards are consistently identified and controlled.',
    action_required_text: 'Define and implement specific improvements to management controls — including permit to work, hot work, housekeeping, contractor management, and impairment procedures — with named owners and target completion dates. Evidence implementation through documented audits or inspection records.',
    hazard_text: 'Weak management controls increase the frequency and severity of incidents by allowing hazardous conditions to persist undetected and by reducing the effectiveness of other installed controls.',
  },

  // ── HRG occupancy driver canonical keys ──────────────────────────────────
  natural_hazard_exposure_and_controls: {
    title: 'Strengthen natural hazard exposure controls to engineering standard',
    observation_text: 'Natural hazard exposure controls have been assessed below the acceptable engineering standard. Current mitigation measures are insufficient to reliably limit loss severity under credible natural hazard scenarios.',
    action_required_text: 'Conduct a focused natural hazard exposure review and implement corrective measures — including physical protection, operational procedures, and emergency response provisions — with a named accountable owner and target completion date. Evidence completion through documented assessment or inspection records.',
    hazard_text: 'Sub-standard natural hazard controls create unmitigated pathways for weather, flood, seismic, or subsidence-related damage that can cause significant structural loss and prolonged business interruption.',
  },
  electrical_and_utilities_reliability: {
    title: 'Improve electrical and utilities reliability to engineering standard',
    observation_text: 'Electrical supply and utilities reliability have been assessed below the acceptable engineering standard. Backup arrangements, resilience controls, and failure-mode protection are insufficient.',
    action_required_text: 'Complete an electrical and utilities resilience review. Implement improvements including backup power provision, automatic changeover, supply monitoring, and utility failure response procedures. Assign a named accountable owner and target completion date.',
    hazard_text: 'Sub-standard utilities reliability can remove critical safety, suppression, and process control systems during incident conditions, significantly increasing loss severity and business interruption duration.',
  },
  process_control_and_stability: {
    title: 'Improve process control and stability to engineering standard',
    observation_text: 'Process control and stability have been assessed below the acceptable engineering standard. Control effectiveness is insufficient to prevent process deviations that could lead to fire, explosion, or toxic release.',
    action_required_text: 'Review process control systems, instrumentation, alarm management, and deviation response procedures. Implement corrective measures with a named accountable owner and target completion date.',
    hazard_text: 'Inadequate process control can allow hazardous process conditions to develop unchecked, increasing fire, explosion, and toxic release risk beyond containment design assumptions.',
  },
  safety_and_control_systems: {
    title: 'Strengthen safety and control system performance to engineering standard',
    observation_text: 'Safety and control system performance has been assessed below the acceptable engineering standard. Current arrangements do not provide sufficient confidence in reliable hazard detection and emergency response.',
    action_required_text: 'Review safety instrumented systems, emergency shutdown logic, detector coverage, and proof-test frequencies. Implement corrective measures and validate function by independent test. Assign a named owner and target completion date.',
    hazard_text: 'Under-performing safety systems can allow incident escalation beyond designed containment limits, increasing loss severity and complicating emergency response.',
  },
  process_safety_management: {
    title: 'Strengthen process safety management to engineering standard',
    observation_text: 'Process safety management has been assessed below the acceptable engineering standard. Current arrangements — including management of change, process hazard analysis, and mechanical integrity — are insufficient.',
    action_required_text: 'Conduct a process safety management gap assessment against the applicable standard (e.g., IEC 61511, API RP 750, or equivalent). Implement prioritised corrective actions with named owners and completion dates. Evidence through documented audits and close-out records.',
    hazard_text: 'Weak process safety management increases the probability of major loss events from process deviations, inadequate change control, or unidentified hazards, with potentially severe property, liability, and business interruption consequences.',
  },
  flammable_liquids_and_fire_risk: {
    title: 'Improve flammable liquid controls and fire risk mitigation',
    observation_text: 'Flammable liquid handling, storage, and associated fire risk controls have been assessed below the acceptable engineering standard.',
    action_required_text: 'Review flammable liquid storage, dispensing, containment, ignition source controls, and detection/suppression provision. Implement corrective actions with named owners and target completion dates. Evidence through documented inspection.',
    hazard_text: 'Sub-standard flammable liquid controls create conditions for rapid fire development with high heat release, increasing both property damage and the risk of structural loss and business interruption.',
  },
  critical_equipment_reliability: {
    title: 'Improve critical equipment reliability and maintenance governance',
    observation_text: 'Critical equipment reliability and maintenance governance have been assessed below the acceptable engineering standard. Maintenance programme quality and evidence are insufficient.',
    action_required_text: 'Identify critical equipment items, implement risk-based maintenance programmes, and improve defect close-out tracking. Strengthen condition monitoring and spare parts provision for high-consequence items. Assign named owners and target dates.',
    hazard_text: 'Sub-standard maintenance governance increases the probability of critical equipment failures that could initiate or escalate incidents, and may also reduce the reliability of safety and suppression systems when most needed.',
  },
  high_energy_materials_control: {
    title: 'Strengthen control of high-energy materials to engineering standard',
    observation_text: 'Controls over high-energy or reactive materials have been assessed below the acceptable engineering standard. Storage, handling, and emergency response arrangements are insufficient.',
    action_required_text: 'Review high-energy material inventories, storage conditions, separation distances, and emergency response procedures. Implement corrective measures with named owners and target dates. Evidence through documented inspection or hazard assessment records.',
    hazard_text: 'Inadequate control of high-energy or reactive materials creates conditions for rapid escalation that can overwhelm installed protection, cause structural damage, and severely impact surrounding assets.',
  },
  high_energy_process_equipment: {
    title: 'Improve high-energy process equipment controls and integrity',
    observation_text: 'High-energy process equipment controls and mechanical integrity have been assessed below the acceptable engineering standard.',
    action_required_text: 'Review mechanical integrity programmes for high-energy equipment, pressure protection, inspection schedules, and overpressure response procedures. Implement prioritised corrective actions with named owners and target completion dates.',
    hazard_text: 'Inadequate control of high-energy process equipment can allow catastrophic equipment failure, increasing loss severity and creating secondary hazards for adjacent assets and personnel.',
  },
  emergency_response_and_bcp: {
    title: 'Improve emergency response and business continuity planning',
    observation_text: 'Emergency response capabilities and business continuity planning have been assessed below the acceptable engineering standard. Current arrangements are insufficient to limit loss severity and support effective recovery.',
    action_required_text: 'Review and strengthen emergency response plans, on-site resource provisions, brigade arrangements, and business continuity recovery procedures. Conduct drills and document performance. Assign a named owner and target completion date.',
    hazard_text: 'Sub-standard emergency response and continuity planning can significantly extend incident duration and property damage, and delay resumption of operations, increasing overall loss.',
  },

  // ── RE03 factor keys ──────────────────────────────────────────────────────
  re03_occ_fire_load_density: {
    title: 'Reduce fire load density to an acceptable level',
    observation_text: 'The assessed fire load density is above the acceptable threshold for the occupancy type and available protection standard. Current storage, process, or material arrangements create a high-risk fire load concentration.',
    action_required_text: 'Review storage arrangements, material quantities, and area utilisation. Implement measures to reduce fire load density including maximum stock height controls, fire load zoning, increased compartmentation, or enhanced suppression in high-density areas.',
    hazard_text: 'Excessive fire load density can overwhelm installed suppression, accelerate structural heating, and increase the probability of total loss across the affected area.',
  },
};

// ─── Wording resolution (mirrors remediationMap.ts) ───────────────────────────

function humanizeKey(key) {
  return key
    .replace(/^re\d+_fp_/i, '')
    .replace(/^RE_\d+_/i, '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim();
}

function improvedGeneric(key) {
  const label = humanizeKey(key);
  return {
    title: `Strengthen ${label} to engineering standard`,
    observation_text:
      `${label} has been assessed below the acceptable engineering standard. ` +
      `Current control effectiveness is insufficient to reliably limit loss severity under foreseeable incident conditions.`,
    action_required_text:
      `Define and implement specific corrective measures for ${label} with a named accountable owner and a target completion date. ` +
      `Evidence completion through documented inspection or test records. ` +
      `Interim risk management measures should be applied until permanent remediation is confirmed.`,
    hazard_text:
      `Sub-standard performance in ${label} creates a pathway for incident escalation that current defences may not interrupt reliably. ` +
      `A foreseeable event could develop faster and with greater severity than planning assumptions allow, ` +
      `increasing physical damage, restoration complexity and interruption duration.`,
  };
}

function resolveWording(sourceFactorKey, sourceModuleKey) {
  // 1. Specific factor key (strip :buildingId suffix for synthetic keys)
  if (sourceFactorKey) {
    const base = sourceFactorKey.split(':')[0];
    if (WORDING_MAP[base]) return WORDING_MAP[base];
  }
  // 2. Module-level key
  if (sourceModuleKey && WORDING_MAP[sourceModuleKey]) {
    return WORDING_MAP[sourceModuleKey];
  }
  // 3. Improved generic
  return improvedGeneric(sourceFactorKey ?? sourceModuleKey ?? 'unknown_factor');
}

// ─── Output helpers ───────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';

function truncate(str, n) {
  if (!str) return '(empty)';
  return str.length <= n ? str : str.slice(0, n - 1) + '…';
}

function col(value, width) {
  const s = String(value ?? '');
  return s.padEnd(width).slice(0, width);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const modeLabel = DRY_RUN
    ? `${YELLOW}DRY RUN${RESET} — no changes will be written`
    : `${RED}${BOLD}APPLY${RESET}   — database will be updated`;

  console.log('');
  console.log(`${BOLD}RE Recommendation Generic-Wording Remediation${RESET}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode     : ${modeLabel}`);
  console.log(`Scope    : ${FILTER_DOC_ID ? `document ${FILTER_DOC_ID}` : 'all documents'}`);
  console.log('');

  // ── Query ─────────────────────────────────────────────────────────────────
  // Fetch by source_type + hazard_text signature.  This is the tightest safe
  // filter: no manually edited row will carry the constant old generic text.
  let query = supabase
    .from('re_recommendations')
    .select([
      'id',
      'document_id',
      'source_type',
      'source_module_key',
      'source_factor_key',
      'title',
      'observation_text',
      'action_required_text',
      'hazard_text',
      'status',
      'priority',
    ].join(', '))
    .eq('source_type', 'auto')
    .eq('hazard_text', OLD_GENERIC_HAZARD_TEXT);

  if (FILTER_DOC_ID) {
    query = query.eq('document_id', FILTER_DOC_ID);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error(`${RED}ERROR querying re_recommendations:${RESET}`, error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log(`${GREEN}✓ No rows match the old generic wording signature. Nothing to do.${RESET}`);
    return;
  }

  // Also catch any row where action_required_text starts with the old prefix
  // but hazard_text was already touched — belt-and-braces.  We handle the
  // primary query result set only; log a reminder.
  console.log(
    `${CYAN}${BOLD}${rows.length} row(s)${RESET}${CYAN} found with old generic wording signature.${RESET}\n`,
  );

  // ── Group by factor key for summary ──────────────────────────────────────
  /** @type {Map<string, number>} */
  const keyCount = new Map();
  for (const row of rows) {
    const k = row.source_factor_key || row.source_module_key || '(no key)';
    keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  }

  console.log(`${BOLD}Affected factor / module keys:${RESET}`);
  for (const [key, count] of [...keyCount].sort()) {
    const sample = rows.find(r => (r.source_factor_key || r.source_module_key || '(no key)') === key);
    const newW = resolveWording(sample.source_factor_key, sample.source_module_key);
    console.log(
      `  ${CYAN}${key.padEnd(48)}${RESET}` +
      `${DIM}×${RESET} ${String(count).padStart(3)}  →  ${truncate(newW.title, 60)}`,
    );
  }
  console.log('');

  // ── Tabular dry-run detail ────────────────────────────────────────────────
  const COL = { docId: 36, recId: 36, module: 22, factor: 38, curTitle: 44, newTitle: 44 };
  const HEADER =
    `${'document_id'.padEnd(COL.docId)}  ` +
    `${'rec_id'.padEnd(COL.recId)}  ` +
    `${'source_module'.padEnd(COL.module)}  ` +
    `${'source_factor'.padEnd(COL.factor)}  ` +
    `${'current_title'.padEnd(COL.curTitle)}  ` +
    `proposed_title`;
  const DIVIDER = '─'.repeat(HEADER.length);

  console.log(`${BOLD}${HEADER}${RESET}`);
  console.log(DIVIDER);

  for (const row of rows) {
    const newW = resolveWording(row.source_factor_key, row.source_module_key);
    console.log(
      `${col(row.document_id,        COL.docId)}  ` +
      `${col(row.id,                 COL.recId)}  ` +
      `${col(row.source_module_key,  COL.module)}  ` +
      `${col(row.source_factor_key,  COL.factor)}  ` +
      `${YELLOW}${col(truncate(row.title, COL.curTitle), COL.curTitle)}${RESET}  ` +
      `${GREEN}${truncate(newW.title, COL.newTitle)}${RESET}`,
    );
  }

  console.log(DIVIDER);
  console.log(`${BOLD}${rows.length} row(s) would be updated.${RESET}`);
  console.log('');

  if (DRY_RUN) {
    console.log(
      `${YELLOW}Dry run complete.${RESET} ` +
      'Re-run with --apply to commit these changes.',
    );
    console.log('');
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  console.log(`${BOLD}Applying updates…${RESET}`);
  let updated = 0;
  let skipped = 0;
  const errors = [];

  // Batches of 50 to avoid request timeout on large sets
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    await Promise.all(
      batch.map(async (row) => {
        const newW = resolveWording(row.source_factor_key, row.source_module_key);
        const { error: updateError, count } = await supabase
          .from('re_recommendations')
          .update({
            title:                newW.title,
            observation_text:     newW.observation_text,
            action_required_text: newW.action_required_text,
            hazard_text:          newW.hazard_text,
          })
          // Double-guard: re-assert both identity conditions.
          // If a manual edit changed hazard_text between our SELECT and this
          // UPDATE the WHERE won't match, and count will be 0 — we skip safely.
          .eq('id',          row.id)
          .eq('source_type', 'auto')
          .eq('hazard_text', OLD_GENERIC_HAZARD_TEXT);

        if (updateError) {
          errors.push({ id: row.id, message: updateError.message });
        } else if (count === 0) {
          // Row changed between SELECT and UPDATE — skip, log.
          skipped++;
          console.log(`  ${YELLOW}SKIPPED${RESET} ${row.id} (changed since read)`);
        } else {
          updated++;
          process.stdout.write('.');
        }
      }),
    );
  }

  console.log('');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`${GREEN}${BOLD}Updated ${RESET}: ${updated} row(s)`);
  if (skipped > 0) console.log(`${YELLOW}Skipped ${RESET}: ${skipped} row(s) (changed between read and write)`);
  if (errors.length > 0) {
    console.log(`${RED}Errors  ${RESET}: ${errors.length} row(s)`);
    for (const e of errors) console.log(`  id=${e.id}: ${e.message}`);
  }
  console.log('');
  console.log('Preserved : status, priority, target_date, evidence, photos,');
  console.log('            attachments, created_at, metadata, history,');
  console.log('            source_module_key, source_factor_key, and all');
  console.log('            other columns not listed above.');
  console.log('');
  console.log('Manually edited recommendations were NOT touched — they do not');
  console.log('carry the old constant hazard_text signature.');
}

main().catch(err => {
  console.error(`${RED}Fatal:${RESET}`, err.message ?? err);
  process.exit(1);
});
