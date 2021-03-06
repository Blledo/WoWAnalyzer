import React from 'react';
import Analyzer, { SELECTED_PLAYER, Options } from 'parser/core/Analyzer';
import { formatPercentage } from 'common/format';
import SPELLS from 'common/SPELLS';
import BoringSpellValueText from 'interface/statistics/components/BoringSpellValueText';
import Haste from 'interface/icons/Haste';
import UptimeIcon from 'interface/icons/Uptime';
import Events from 'parser/core/Events';
import Statistic from 'interface/statistics/Statistic';
import STATISTIC_CATEGORY from 'interface/others/STATISTIC_CATEGORY';
import { DIRE_BEAST_HASTE_PERCENT } from 'parser/hunter/shared/constants';

/**
 * Kill Command deals n additional damage, and has a chance to summon a Dire
 * Beast.
 *
 * Example report:
 * https://www.warcraftlogs.com/reports/hqJFrknaDMRHmtWj/#fight=27&type=damage-done
 * - SV
 * https://www.warcraftlogs.com/reports/6j2JbBTKMXYVy4mA#fight=7&type=damage-done
 * - BM
 */
class DireConsequences extends Analyzer {

  procs = 0;

  constructor(options: Options) {
    super(options);
    this.active = this.selectedCombatant.hasTrait(SPELLS.DIRE_CONSEQUENCES.id);
    this.addEventListener(Events.applybuff.by(SELECTED_PLAYER).spell(SPELLS.DIRE_BEAST_BUFF), this.buffApplication);
  }

  get uptime() {
    return this.selectedCombatant.getBuffUptime(SPELLS.DIRE_BEAST_BUFF.id) / this.owner.fightDuration;
  }

  buffApplication() {
    this.procs += 1;
  }

  statistic() {
    return (
      <Statistic
        size="flexible"
        category={STATISTIC_CATEGORY.AZERITE_POWERS}
      >
        <BoringSpellValueText spell={SPELLS.DIRE_CONSEQUENCES}>
          <>
            <Haste /> {formatPercentage(DIRE_BEAST_HASTE_PERCENT * this.uptime)}% <small>Haste</small><br />
            <UptimeIcon /> {formatPercentage(this.uptime)}% <small>uptime</small><br />
            {this.procs} <small>procs</small>
          </>
        </BoringSpellValueText>
      </Statistic>
    );
  }
}

export default DireConsequences;
