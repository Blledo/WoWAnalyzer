import React from 'react';
import { formatPercentage } from 'common/format';
import StatisticBox from 'interface/others/StatisticBox';
import SpellIcon from 'common/SpellIcon';
import SpellLink from 'common/SpellLink';
import AbilityTracker from 'parser/shared/modules/AbilityTracker';

import SPELLS from 'common/SPELLS';
import Analyzer from 'parser/core/Analyzer';
import HealingValue from 'parser/shared/modules/HealingValue';

const MS_BUFFER = 200;
const RECOMMENDED_HIT_THRESHOLD = 5;
const PRECAST_PERIOD = 3000;
const PRECAST_THRESHOLD = 0.5;

// TODO - dynamic suggestion threshold based on variables such as Autumn leaves
class WildGrowth extends Analyzer {
  static dependencies = {
    abilityTracker: AbilityTracker,
  };

  lastWgCast = 0;
  wgCounter = 0;
  wgHits = [];
  wgHistory = [];
  wgTracker = {};

  on_byPlayer_cast(event) {
    const spellId = event.ability.guid;
    if (spellId !== SPELLS.WILD_GROWTH.id) {
      return;
    }

    if(Object.getOwnPropertyNames(this.wgTracker).length > 0) {
      this.wgTracker.badPrecast = (this.wgTracker.firstTicksOverheal / this.wgTracker.firstTicksRaw) > PRECAST_THRESHOLD;
      this.wgHistory.push(this.wgTracker);
    }
    this.wgTracker = {};
    this.wgTracker.wgBuffs = [];
    this.wgTracker.startTimestamp = event.timestamp;
    this.wgTracker.heal = 0;
    this.wgTracker.overheal = 0;
    this.wgTracker.firstTicksOverheal = 0;
    this.wgTracker.firstTicksRaw = 0;
  }

  on_byPlayer_heal(event) {
    const spellId = event.ability.guid;
    if (spellId !== SPELLS.WILD_GROWTH.id) {
      return;
    }
    const healVal = new HealingValue(event.amount, event.absorbed, event.overheal);
    this.wgTracker.heal += healVal.effective;
    this.wgTracker.overheal += healVal.overheal;

    // Track overhealing first couple ticks to determine if WG was precast before damaging event.
    if(event.timestamp - this.wgTracker.startTimestamp < PRECAST_PERIOD) {
      this.wgTracker.firstTicksRaw += healVal.raw;
      this.wgTracker.firstTicksOverheal += healVal.overheal;
    }
  }

  on_byPlayer_applybuff(event) {
    const spellId = event.ability.guid;
    if (spellId !== SPELLS.WILD_GROWTH.id) {
      return;
    }
    this.wgTracker.wgBuffs.push(event.targetID);

    // We check all "recent" WG applications by the player and assume that all WGs applied within a small timeframe to be applied by the same cast.
    // TODO - refactor below snippet (and related code) and use wgHistory array instead.
    if(this.lastWgCast === 0) {
      this.lastWgCast = event.timestamp;
    }
    if(event.timestamp - this.lastWgCast < MS_BUFFER) {
      this.wgCounter++;
    } else {
      this.wgHits.push(this.wgCounter);
      this.lastWgCast = event.timestamp;
      this.wgCounter = 1;
    }
  }

  on_finished() {
    this.wgHits.push(this.wgCounter);
    this.wgHistory.push(this.wgTracker);
  }

  get averageEffectiveHits() {
    return (this.wgHits.reduce((a, b) => a + b, 0) / this.wgs) || 0;
  }

  get belowRecommendedCasts() {
    return this.wgHits.filter(hits => hits < RECOMMENDED_HIT_THRESHOLD).length;
  }

  get belowRecommendedCasts2() {
    return this.wgHistory.filter(wg => wg.badPrecast === true).length;
  }

  get wgs() {
    return this.abilityTracker.getAbility(SPELLS.WILD_GROWTH.id).casts || 0;
  }

  get rejuvs() {
    return this.abilityTracker.getAbility(SPELLS.REJUVENATION.id).casts || 0;
  }

  get wgsPerRejuv() {
    return (this.wgs / this.rejuvs) || 0;
  }

  get percentBelowRecommendedCasts() {
    return (this.belowRecommendedCasts / this.wgs) || 0;
  }

  get percentBelowRecommendedCasts2() {
    return (this.belowRecommendedCasts2 / this.wgs) || 0;
  }

  get suggestionThresholds() {
    return {
      actual: this.wgsPerRejuv,
      isLessThan: {
        minor: 0.12,
        average: 0.08,
        major: 0.03,
      },
      style: 'percentage',
    };
  }

  get suggestionpercentBelowRecommendedCastsThresholds() {
    return {
      actual: this.percentBelowRecommendedCasts,
      isGreaterThan: {
        minor: 0.00,
        average: 0.15,
        major: 0.35,
      },
      style: 'percentage',
    };
  }

  get suggestionpercentBelowRecommendedCasts2Thresholds() {
    return {
      actual: this.percentBelowRecommendedCasts2,
      isGreaterThan: {
        minor: 0.05,
        average: 0.15,
        major: 0.35,
      },
      style: 'percentage',
    };
  }

  suggestions(when) {
    when(this.suggestionpercentBelowRecommendedCasts2Thresholds)
      .addSuggestion((suggest, actual, recommended) => {
        return suggest(<>Your initial healing from <SpellLink id={SPELLS.WILD_GROWTH.id} /> were doing too much overhealing. <SpellLink id={SPELLS.WILD_GROWTH.id} /> does most of it's healing initially and declines over duration. Make sure you are not precasting it before damaging event but after damage occurs.
        </>)
          .icon(SPELLS.WILD_GROWTH.icon)
          .actual(`${Math.round(formatPercentage(actual))}% of casts with high overhealing.`)
          .recommended(`<${Math.round(formatPercentage(recommended))}% is recommended`);
      });
    when(this.suggestionpercentBelowRecommendedCastsThresholds)
      .addSuggestion((suggest) => {
        return suggest(<>You sometimes cast <SpellLink id={SPELLS.WILD_GROWTH.id} /> on too few targets. <SpellLink id={SPELLS.WILD_GROWTH.id} /> is not mana efficient when hitting few targets, you should only cast it when you can hit at least {RECOMMENDED_HIT_THRESHOLD} wounded targets. Make sure you are not casting on a primary target isolated from the raid. <SpellLink id={SPELLS.WILD_GROWTH.id} /> has a maximum hit radius, the injured raiders could have been out of range. Also, you should never pre-hot with <SpellLink id={SPELLS.WILD_GROWTH.id} />.
        </>)
          .icon(SPELLS.WILD_GROWTH.icon)
          .actual(`${formatPercentage(this.percentBelowRecommendedCasts, 0)}% casts on fewer than ${RECOMMENDED_HIT_THRESHOLD} targets.`)
          .recommended(`never casting on fewer than ${RECOMMENDED_HIT_THRESHOLD} is recommended`);
      });
    when(this.suggestionThresholds)
      .addSuggestion((suggest, actual, recommended) => {
        return suggest(<>Your <SpellLink id={SPELLS.WILD_GROWTH.id} /> to rejuv ratio can be improved, try to cast more wild growths if possible as it is usually more efficient.</>,)
          .icon(SPELLS.WILD_GROWTH.icon)
          .actual(`${this.wgs} WGs / ${this.rejuvs} rejuvs`)
          .recommended(`>${Math.round(formatPercentage(recommended))}% is recommended`);
      });
  }

  statistic() {
    return (
      <StatisticBox
        icon={<SpellIcon id={SPELLS.WILD_GROWTH.id} />}
        value={`${this.averageEffectiveHits.toFixed(2)}`}
        label="Average Wild Growth hits"
        tooltip={
          `Your Wild Growth hit on average ${this.averageEffectiveHits.toFixed(2)} players. ${this.belowRecommendedCasts} of your cast(s) hit fewer than 5 players which is the recommended targets.`
        }
      />
    );
  }
}

export default WildGrowth;
