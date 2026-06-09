#!/usr/bin/env node
/**
 * remediate-generic-recommendations.mjs
 *
 * One-off admin remediation script.
 * Updates auto-generated RE recommendations that still contain the old generic
 * fallback wording with the new module-specific wording.
 *
 * SAFETY RULES:
 *   - Only touches rows where source_type = 'auto'.
 *   - Only touches rows whose hazard_text exactly matches the old constant
 *     generic signature — manually edited recommendations will never match
 *     that signature, so they are never touched.
 *   - Preserves: status, priority, target_date, evidence, photos, metadata,
 *     and every other column except title / observation_text /
 *     action_required_text / hazard_text.
 *   - Runs in DRY-RUN mode by default — prints affected rows without writing.
 *   - Pass --apply to commit changes.
 *
 * REQUIREMENTS:
 *   - Node 20.6+ (uses --env-file for .env loading)
 *   - @supabase/supabase-js must be installed (it is, as a project dependency)
 *   - Set SUPABASE_SERVICE_ROLE_KEY in your .env (preferred) or the script
 *     falls back to VITE_SUPABASE_ANON_KEY with a warning.
 *
 * USAGE:
 *   # Dry run — show what would change, touch nothing:
 *   node --env-file=.env scripts/remediate-generic-recommendations.mjs
 *
 *   # Apply changes:
 *   node --env-file=.env scripts/remediate-generic-recommendations.mjs --apply
 *
 *   # Filter to a single document (useful for staging):
 *   node --env-file=.env scripts/remediate-generic-recommendations.mjs --document-id=<uuid>
 *
 *   # Combine:
 *   node --env-file=.env scripts/remediate-generic-recommendations.mjs --document-id=<uuid> --apply
 */

import { createClient } from '@supabase/supabase-js';

// ─── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const docIdArg = args.find(a => a.startsWith('--document-id='));
const FILTER_DOCUMENT_ID = docIdArg ? docIdArg.split('=')[1] : null;

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
    'WARNING: SUPABASE_SERVICE_ROLE_KEY not found — using anon key. ' +
    'RLS policies may prevent some updates. Prefer service role for admin scripts.',
  );
}

const supabase = createClient(supabaseUrl, apiKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Old generic wording signature ───────────────────────────────────────────
// This exact hazard text was produced by every old generic fallback. It is
// constant across all factor keys, making it the safest detection signal.
// Manually edited recommendations will never contain this text unchanged.
const OLD_GENERIC_HAZARD_TEXT =
  'Inadequate controls increase the likelihood of loss events escalating beyond planned defenses. A foreseeable incident could develop faster than current safeguards allow, increasing damage extent and recovery time. Strengthening this control reduces overall facility risk profile.';

// Secondary patterns that also uniquely identify old generic wording.
// Used as a cross-check when dry-running.
const OLD_GENERIC_ACTION_PREFIX = 'Review and implement improvements to bring ';
const OLD_GENERIC_ACTION_SUFFIX = 'up to acceptable standards. Address identified deficiencies through documented corrective actions with clear ownership and target dates.';
const OLD_GENERIC_OBSERVATION_SUFFIX = 'has been identified as requiring attention based on current site conditions. Control effectiveness is below acceptable standards and requires corrective action.';

// ─── New wording map ──────────────────────────────────────────────────────────
// Mirrors src/lib/re/recommendations/recommendationPipeline.ts FACTOR_SPECIFIC_FALLBACKS
// for all non-RE06 entries plus the module-level fallbacks added in the wording
// audit. RE06 entries are included as a safety net for any that used the old
// generic path.
//
// When a sourceFactorKey has a specific entry → use it.
// When only sourceModuleKey is available → use the module-level entry.
// Anything else → use the improved generic wording (better than old, still
//   parameterised by factorLabel).
const NEW_WORDING = {
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

// ─── Improved generic fallback (for keys not in NEW_WORDING) ──────────────────
// Used for any old-wording record whose factor key isn't in the map above.
// Produces: "Strengthen <Factor Label> to engineering standard" style content.
function humanizeFactorKey(key) {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .replace(/^Re\d+\s+/i, '')
    .replace(/^re\d+_fp_/i, '')
    .trim();
}

function improvedGenericFallback(factorKey) {
  const label = humanizeFactorKey(factorKey);
  return {
    title: `Strengthen ${label} to engineering standard`,
    observation_text: `${label} has been assessed below the acceptable engineering standard. Current control effectiveness is insufficient to reliably limit loss severity under foreseeable incident conditions.`,
    action_required_text: `Define and implement specific corrective measures for ${label} with a named accountable owner and a target completion date. Evidence completion through documented inspection or test records. Interim risk management measures should be applied until permanent remediation is confirmed.`,
    hazard_text: `Sub-standard performance in ${label} creates a pathway for incident escalation that current defences may not interrupt reliably. A foreseeable event could develop faster and with greater severity than planning assumptions allow, increasing physical damage, restoration complexity and interruption duration.`,
  };
}

// Look up the best available new wording for a record.
function resolveNewWording(sourceFactorKey, sourceModuleKey) {
  const key = sourceFactorKey || sourceModuleKey || '';
  return NEW_WORDING[key] || improvedGenericFallback(key || 'unknown_factor');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('RE Recommendation Generic-Wording Remediation');
  console.log('═══════════════════════════════════════════════');
  console.log(`Mode          : ${DRY_RUN ? 'DRY RUN (no changes will be written)' : '⚠  APPLY — database will be updated'}`);
  console.log(`Filter doc    : ${FILTER_DOCUMENT_ID || '(all documents)'}`);
  console.log('');

  // ── Query affected rows ───────────────────────────────────────────────────
  let query = supabase
    .from('re_recommendations')
    .select('id, document_id, source_type, source_module_key, source_factor_key, title, observation_text, action_required_text, hazard_text, status, priority')
    .eq('source_type', 'auto')
    .eq('hazard_text', OLD_GENERIC_HAZARD_TEXT);

  if (FILTER_DOCUMENT_ID) {
    query = query.eq('document_id', FILTER_DOCUMENT_ID);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error('ERROR querying re_recommendations:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('✓ No rows found matching the old generic wording signature. Nothing to do.');
    return;
  }

  // ── Group by factor key for summary ──────────────────────────────────────
  const byKey = {};
  for (const row of rows) {
    const key = row.source_factor_key || row.source_module_key || '(no key)';
    (byKey[key] = byKey[key] || []).push(row);
  }

  console.log(`Found ${rows.length} row(s) with old generic wording across ${Object.keys(byKey).length} distinct factor/module key(s).\n`);
  console.log('Affected factor/module keys:');
  for (const [key, keyRows] of Object.entries(byKey)) {
    const newWording = resolveNewWording(
      keyRows[0].source_factor_key,
      keyRows[0].source_module_key,
    );
    console.log(`  ${key.padEnd(45)} × ${String(keyRows.length).padStart(3)} row(s) → "${newWording.title}"`);
  }
  console.log('');

  // ── Show detail in dry run ────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('Dry-run details (first 20 rows):');
    const preview = rows.slice(0, 20);
    for (const row of preview) {
      const newWording = resolveNewWording(row.source_factor_key, row.source_module_key);
      console.log(`  id=${row.id}`);
      console.log(`    document_id : ${row.document_id}`);
      console.log(`    factor_key  : ${row.source_factor_key || '(none)'}`);
      console.log(`    module_key  : ${row.source_module_key}`);
      console.log(`    status      : ${row.status || '(none)'} | priority: ${row.priority || '(none)'}`);
      console.log(`    old title   : ${row.title}`);
      console.log(`    new title   : ${newWording.title}`);
      console.log('');
    }
    if (rows.length > 20) {
      console.log(`  … and ${rows.length - 20} more row(s) not shown.`);
      console.log('');
    }
    console.log('DRY RUN complete. Re-run with --apply to commit these changes.');
    return;
  }

  // ── Apply updates ─────────────────────────────────────────────────────────
  console.log('Applying updates…');
  let updated = 0;
  let failed = 0;
  const failedIds = [];

  // Update in batches of 50 to avoid timeout on large sets
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    await Promise.all(
      batch.map(async (row) => {
        const newWording = resolveNewWording(row.source_factor_key, row.source_module_key);
        const { error: updateError } = await supabase
          .from('re_recommendations')
          .update({
            title: newWording.title,
            observation_text: newWording.observation_text,
            action_required_text: newWording.action_required_text,
            hazard_text: newWording.hazard_text,
          })
          .eq('id', row.id)
          // Double-check guard: only update if hazard_text still matches
          // the old signature (prevents re-updating manually changed rows
          // that were somehow in the result set)
          .eq('hazard_text', OLD_GENERIC_HAZARD_TEXT)
          .eq('source_type', 'auto');

        if (updateError) {
          console.error(`  FAILED id=${row.id}: ${updateError.message}`);
          failed++;
          failedIds.push(row.id);
        } else {
          updated++;
          process.stdout.write('.');
        }
      }),
    );
  }

  console.log('');
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`Updated : ${updated} row(s)`);
  if (failed > 0) {
    console.log(`Failed  : ${failed} row(s)`);
    console.log('Failed IDs:', failedIds.join(', '));
  }
  console.log('');
  console.log('Preserved fields: status, priority, target_date, evidence,');
  console.log('  photos, metadata, history, and all other columns.');
  console.log('');
  console.log('Manually edited recommendations were not touched (they do not');
  console.log('  contain the old constant hazard text signature).');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
