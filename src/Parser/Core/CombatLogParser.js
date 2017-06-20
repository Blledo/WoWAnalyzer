import React from 'react';

import ITEMS from 'common/ITEMS';
import ItemLink from 'common/ItemLink';

import Combatants from './Modules/Combatants';
import AbilityTracker from './Modules/AbilityTracker';
import AlwaysBeCasting from './Modules/AlwaysBeCasting';
import Enemies from './Modules/Enemies';

// Shared Legendaries
import Prydaz from './Modules/Items/Prydaz';
import Velens from './Modules/Items/Velens';
import SephuzsSecret from './Modules/Items/SephuzsSecret';
// Shared Epics
import DrapeOfShame from './Modules/Items/DrapeOfShame';
import DarkmoonDeckPromises from './Modules/Items/DarkmoonDeckPromises';
import AmalgamsSeventhSpine from './Modules/Items/AmalgamsSeventhSpine';
import ArchiveOfFaith from './Modules/Items/ArchiveOfFaith';
import BarbaricMindslaver from './Modules/Items/BarbaricMindslaver';
import SeaStar from './Modules/Items/SeaStarOfTheDepthmother';
import DeceiversGrandDesign from './Modules/Items/DeceiversGrandDesign';
import GnawedThumbRing from './Modules/Items/GnawedThumbRing';

import ParseResults from './ParseResults';
import SUGGESTION_IMPORTANCE from './ISSUE_IMPORTANCE';

function formatThousands(number) {
  return (Math.round(number || 0) + '').replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,");
}
function formatNumber(number) {
  if (number > 1000000) {
    return `${(number / 1000000).toFixed(2)}m`;
  }
  if (number > 10000) {
    return `${Math.round(number / 1000)}k`;
  }
  return formatThousands(number);
}
function formatPercentage(percentage) {
  return (Math.round((percentage || 0) * 10000) / 100).toFixed(2);
}
function getSuggestionImportance(value, regular, major, higherIsWorse = false) {
  if (higherIsWorse ? value > major : value < major) {
    return SUGGESTION_IMPORTANCE.MAJOR;
  }
  if (higherIsWorse ? value > regular : value < regular) {
    return SUGGESTION_IMPORTANCE.REGULAR;
  }
  return SUGGESTION_IMPORTANCE.MINOR;
}

class CombatLogParser {
  static abilitiesAffectedByHealingIncreases = [];

  static defaultModules = {
    combatants: Combatants,
    enemies: Enemies,
    abilityTracker: AbilityTracker,
    alwaysBeCasting: AlwaysBeCasting,

    // Items:
    // Legendaries:
    prydaz: Prydaz,
    velens: Velens,
    sephuzsSecret: SephuzsSecret,
    // Epics:
    drapeOfShame: DrapeOfShame,
    amalgamsSeventhSpine: AmalgamsSeventhSpine,
    darkmoonDeckPromises: DarkmoonDeckPromises,
    gnawedThumbRing: GnawedThumbRing,
    // Tomb trinkets:
    archiveOfFaith: ArchiveOfFaith,
    barbaricMindslaver: BarbaricMindslaver,
    seaStar: SeaStar,
    deceiversGrandDesign: DeceiversGrandDesign,
  };
  // Override this with spec specific modules
  static specModules = {};

  report = null;
  player = null;
  fight = null;

  modules = {};

  get playerId() {
    return this.player.id;
  }

  /** @returns Combatants */
  get combatants() {
    return this.modules.combatants;
  }

  /** @returns {Combatant} */
  get selectedCombatant() {
    return this.combatants.selected;
  }

  get fightDuration() {
    return (this.finished ? this.fight.end_time : this.currentTimestamp) - this.fight.start_time;
  }

  _timestamp = null;

  get currentTimestamp() {
    return this._timestamp;
  }

  get playersById() {
    return this.report.friendlies.reduce((obj, player) => {
      obj[player.id] = player;
      return obj;
    }, {});
  }

  constructor(report, player, fight) {
    this.report = report;
    this.player = player;
    this.fight = fight;

    this.initializeModules(this.constructor.defaultModules);
    this.initializeModules(this.constructor.specModules);
  }

  initializeModules(modules) {
    Object.keys(modules).forEach(key => {
      const value = modules[key];
      // This may override existing modules, this is intended.
      this.modules[key] = new value(this);
    });
  }

  parseEvents(events) {
    return new Promise((resolve, reject) => {
      events.forEach(event => {
        if (this.error) {
          throw new Error(this.error);
        }
        this._timestamp = event.timestamp;

        // Triggering a lot of events here for development pleasure; does this have a significant performance impact?
        this.triggerEvent('event', event);
        this.triggerEvent(event.type, event);
        if (this.byPlayer(event)) {
          this.triggerEvent(`byPlayer_${event.type}`, event);
        }
        if (this.toPlayer(event)) {
          this.triggerEvent(`toPlayer_${event.type}`, event);
        }
      });

      resolve(events.length);
    });
  }

  triggerEvent(eventType, event) {
    const methodName = `on_${eventType}`;
    this.constructor.tryCall(this, methodName, event);
    Object.keys(this.modules)
      .map(key => this.modules[key])
      .sort((a, b) => b.priority - a.priority)
      .filter(module => module.active)
      .forEach(module => {
        this.constructor.tryCall(module, methodName, event);
      });
  }

  static tryCall(object, methodName, event) {
    const method = object[methodName];
    if (method) {
      method.call(object, event);
    }
  }

  byPlayer(event, playerId = this.player.id) {
    return (event.sourceID === playerId);
  }

  toPlayer(event, playerId = this.player.id) {
    return (event.targetID === playerId);
  }

  initialized = false;
  error = null;

  on_initialized() {
    this.initialized = true;
    if (!this.selectedCombatant) {
      this.error = 'The selected player could not be found in this fight. Make sure the log is recorded with Advanced Combat Logging enabled.';
    }
  }

  finished = false;

  on_finished() {
    this.finished = true;
  }

  // This used to be implemented as a sanity check, may be replaced by a cleaner solution.
  totalHealing = 0;

  on_byPlayer_heal(event) {
    this.totalHealing += event.amount + (event.absorbed || 0);
  }

  on_byPlayer_absorbed(event) {
    this.totalHealing += event.amount + (event.absorbed || 0);
  }

  totalDamage = 0;

  on_byPlayer_damage(event) {
    this.totalDamage += event.amount + (event.absorbed || 0);
  }

  // TODO: Damage taken from LOTM

  static SUGGESTION_VELENS_BREAKPOINT = 0.045;

  generateResults() {
    const results = new ParseResults();

    const fightDuration = this.fightDuration;
    const getPercentageOfTotal = healingDone => healingDone / this.totalHealing;
    const formatItemHealing = healingDone => `${formatPercentage(getPercentageOfTotal(healingDone))} % / ${formatNumber(healingDone / fightDuration * 1000)} HPS`;

    if (this.modules.prydaz.active) {
      results.items.push({
        item: ITEMS.PRYDAZ_XAVARICS_MAGNUM_OPUS,
        result: formatItemHealing(this.modules.prydaz.healing),
      });
    }
    if (this.modules.velens.active) {
      // TODO: Move this to the Velen's module? having it here stops making sense. If "item" modules could just provide their own item data object & suggestion then everything would be completely together. At that point the parser would have to recognize items automatically and add them to the items array as their modules are loaded. Doing this could be nice as items would be completely isolated in their module files, but I don't think mixing the currently pure JS modules with React is favorable.
      results.items.push({
        item: ITEMS.VELENS_FUTURE_SIGHT,
        result: (
          <dfn data-tip={`The effective healing contributed by the Velen's Future Sight use effect. ${formatPercentage(this.modules.velens.healingIncreaseHealing / this.totalHealing)}% of total healing was contributed by the 15% healing increase and ${formatPercentage(this.modules.velens.overhealHealing / this.totalHealing)}% of total healing was contributed by the overhealing distribution.`}>
            {formatItemHealing(this.modules.velens.healing)}
          </dfn>
        ),
      });
      const velensHealingPercentage = getPercentageOfTotal(this.modules.velens.healing);
      if (velensHealingPercentage < this.constructor.SUGGESTION_VELENS_BREAKPOINT) {
        results.addIssue({
          issue: <span>Your usage of <ItemLink id={ITEMS.VELENS_FUTURE_SIGHT.id} /> can be improved. Try to maximize the amount of healing during the buff without excessively overhealing on purpose, or consider using an easier legendary ({(velensHealingPercentage * 100).toFixed(2)}% healing contributed).</span>,
          icon: ITEMS.VELENS_FUTURE_SIGHT.icon,
          importance: getSuggestionImportance(velensHealingPercentage, this.constructor.SUGGESTION_VELENS_BREAKPOINT - 0.005, this.constructor.SUGGESTION_VELENS_BREAKPOINT - 0.015),
        });
      }
    }
    if (this.modules.sephuzsSecret.active) {
      results.items.push({
        item: ITEMS.SEPHUZS_SECRET,
        result: `${((this.modules.sephuzsSecret.uptime / fightDuration * 100) || 0).toFixed(2)} % uptime`,
      });
    }

    // Epics:
    if (this.modules.drapeOfShame.active) {
      results.items.push({
        item: ITEMS.DRAPE_OF_SHAME,
        result: formatItemHealing(this.modules.drapeOfShame.healing),
      });
    }
    if (this.modules.amalgamsSeventhSpine.active) {
      results.items.push({
        item: ITEMS.AMALGAMS_SEVENTH_SPINE,
        result: (
          <dfn data-tip={`The exact amount of mana gained from the Amalgam's Seventh Spine equip effect. The buff expired successfully ${this.modules.amalgamsSeventhSpine.procs} times and the buff was refreshed ${this.modules.amalgamsSeventhSpine.refreshes} times (refreshing delays the buff expiration and is inefficient use of this trinket).`}>
            {formatThousands(this.modules.amalgamsSeventhSpine.manaGained)} mana gained ({formatThousands(this.modules.amalgamsSeventhSpine.manaGained / this.fightDuration * 1000 * 5)} MP5)
          </dfn>
        ),
      });
    }
    if (this.modules.darkmoonDeckPromises.active) {
      results.items.push({
        item: ITEMS.DARKMOON_DECK_PROMISES,
        result: (
          <dfn data-tip="The exact amount of mana saved by the Darkmoon Deck: Promises equip effect. This takes the different values per card into account at the time of the cast.">
            {formatThousands(this.modules.darkmoonDeckPromises.manaGained)} mana saved ({formatThousands(this.modules.darkmoonDeckPromises.manaGained / this.fightDuration * 1000 * 5)} MP5)
          </dfn>
        ),
      });
    }
    if (this.modules.gnawedThumbRing.active) {
      results.items.push({
        item: ITEMS.GNAWED_THUMB_RING,
        result: formatItemHealing(this.modules.gnawedThumbRing.healingIncreaseHealing),
      });
    }
    if (this.modules.archiveOfFaith.active) {
      const archiveOfFaithHealing = this.modules.archiveOfFaith.healing / this.totalHealing;
      const archiveOfFaithHOTHealing = this.modules.archiveOfFaith.healingOverTime / this.totalHealing;
      const archiveOfFaithHealingTotal = (this.modules.archiveOfFaith.healing + this.modules.archiveOfFaith.healingOverTime) / this.totalHealing;
      results.items.push({
        item: ITEMS.ARCHIVE_OF_FAITH,
        result: (
          <dfn data-tip={`The effective healing contributed by the Archive of Faith on-use effect.<br />Channel: ${((archiveOfFaithHealing * 100) || 0).toFixed(2)} % / ${formatNumber(this.modules.archiveOfFaith.healing / fightDuration * 1000)} HPS<br />HOT: ${((archiveOfFaithHOTHealing * 100) || 0).toFixed(2)} % / ${formatNumber(this.modules.archiveOfFaith.healingOverTime / fightDuration * 1000)} HPS`}>
            {((archiveOfFaithHealingTotal * 100) || 0).toFixed(2)} % / {formatNumber((this.modules.archiveOfFaith.healing + this.modules.archiveOfFaith.healingOverTime) / fightDuration * 1000)} HPS
          </dfn>
        ),
      });
    }
    if (this.modules.barbaricMindslaver.active) {
      results.items.push({
        item: ITEMS.BARBARIC_MINDSLAVER,
        result: formatItemHealing(this.modules.barbaricMindslaver.healing),
      });
    }
    if (this.modules.seaStar.active) {
      results.items.push({
        item: ITEMS.SEA_STAR_OF_THE_DEPTHMOTHER,
        result: formatItemHealing(this.modules.seaStar.healing),
      });
    }
    if (this.modules.deceiversGrandDesign.active) {
      const deceiversGrandDesignHealingPercentage = this.modules.deceiversGrandDesign.healing / this.totalHealing;
      const deceiversGrandDesignAbsorbPercentage = this.modules.deceiversGrandDesign.healingAbsorb / this.totalHealing;
      const deceiversGrandDesignTotalPercentage = (this.modules.deceiversGrandDesign.healing + this.modules.deceiversGrandDesign.healingAbsorb) / this.totalHealing;
      results.items.push({
        item: ITEMS.DECEIVERS_GRAND_DESIGN,
        result: (
          <dfn data-tip={`The effective healing contributed by the Deciever's Grand Design on-use effect.<br />HOT: ${((deceiversGrandDesignHealingPercentage * 100) || 0).toFixed(2)} % / ${formatNumber(this.modules.deceiversGrandDesign.healing / fightDuration * 1000)} HPS<br />Shield Proc: ${((deceiversGrandDesignAbsorbPercentage * 100) || 0).toFixed(2)} % / ${formatNumber(this.modules.deceiversGrandDesign.healingAbsorb / fightDuration * 1000)} HPS`}>
            {((deceiversGrandDesignTotalPercentage * 100) || 0).toFixed(2)} % / {formatNumber((this.modules.deceiversGrandDesign.healing + this.modules.deceiversGrandDesign.healingAbsorb) / fightDuration * 1000)} HPS
          </dfn>
        ),
      });
      if (this.modules.deceiversGrandDesign.proced) {
        results.addIssue({
          issue: <span>Your <ItemLink id={ITEMS.DECEIVERS_GRAND_DESIGN.id} /> procced earlier than expected. The following events procced the effect:<br />
            {this.modules.deceiversGrandDesign.procs
              .map((procs, index) => {
                const url = `https://www.warcraftlogs.com/reports/${procs.report}/#fight=${procs.fight}&source=${procs.target}&type=summary&start=${procs.start}&end=${procs.end}&view=events`;
                return (
                  <div key={index}>
                    Proc {index + 1} on: <a href={url} target="_blank" rel="noopener noreferrer">{procs.name}</a>
                  </div>
                );
              })}
          </span>,
          icon: ITEMS.DECEIVERS_GRAND_DESIGN.icon,
        });
      }
    }

    return results;
  }
}

export default CombatLogParser;
