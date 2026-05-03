(function () {
    const YEAR_OPTIONS = [
        'Current Year',
        '2024-25',
        '2023-24',
        '2022-23',
        '2021-22',
        '2020-21',
        '2019-20',
        '2018-19',
        '2017-18',
        '2016-17',
        '2015-16',
        '2014-15',
        '2013-14',
        '2012-13',
        '2011-12',
        '2010-11',
        '2009-10',
        '2008-09',
        '2007-08',
        '2006-07',
        '2005-06',
        '2004-05'
    ];

    const SPORT_CONFIGS = {
        volleyball: {
            key: 'volleyball',
            label: 'Volleyball',
            sheetName({ gender, year }) {
                const season = year === 'Current Year' ? 'Current Year' : year;
                return `Volleyball ${gender} ${season}`;
            },
            leagueSheetName() {
                return 'Leagues';
            },
            maxPrepsSportSegment: 'volleyball',
            boysCurrentYearDisabled: true,
            supportsAlternateFormats: true,
            setDiffMultiplier: 0.1,
            iterativeQualityPasses: 3,
            qualityTau: 0.25,
            winFloorValue: 0.15,
            homeAdvantage: 0.04,
            wengLinAutoDefaultWeightedMatchCutoff: 6,
            wengLinWeightedMatchCutoff: 6,
            supportsSpotlightPointDiff: true,
            spotlightPointDiffDefaults: {
                enabled: false,
                multiplier: 0.01,
                ratingThreshold: 0.08,
                cap: 0.015
            },
            spotlightPointDiffMode: 'sets',       // parse set detail strings
            spotlightPointDiffNormDivisor: 10,    // 10-pt avg gap per set = fully dominant
            leagueUsesEmbeddedSeasonOnly: true,
            supportsLeagues: true,
            leagueMeetingsPerOpponent: 2,
            showUnrankedTable: true,
            allowedGenders: ['boys', 'girls'],
            weightDefaults: {
                'weight-bo5': 1.0,
                'weight-bo5-split': 0.0,
                'weight-bo3': 0.75,
                'weight-two': 0.1,
                'weight-one': 0.3,
                'weight-forfeit-credit': 0,
                'weight-sos': 0.2
            },
            weightVisibility: {
                'weight-bo5': true,
                'weight-bo5-split': true,
                'weight-bo3': true,
                'weight-two': true,
                'weight-one': true,
                'weight-forfeit-credit': true,
                'weight-sos': true
            },
            weightLabels: {
                'weight-bo5': 'Best of 5 match weight (3-0, 3-1, 3-2):',
                'weight-bo5-split': '5-Set Split Series Weight:',
                'weight-bo3': 'Best of 3 match weight (2-0, 2-1):',
                'weight-two': 'Tie-Set Weight (1-1):',
                'weight-one': 'One-set match weight (1-0):',
                'weight-forfeit-credit': 'Forfeit Win Credit (ignored):',
                'weight-sos': 'Schedule Strength Weight:'
            },
            undefeatedThresholds: {
                perfect: 15,
                bo5: 20
            },
            playoffConfig: {
                divisions: ['OPEN', 'D1', 'D2', 'D3', 'D4', 'D5'],
                openSize: 8,
                defaultSizes: { D1: 16, D2: 16, D3: 20, D4: 20, D5: 20 },
                allowedSizes: [16, 18, 20, 22, 24]
            },
            keyHtml: null,  // Set after SHARED_KEY_HTML is defined
            flawsHtml: null // Set after SHARED_FLAWS_HTML is defined
        }
    };

    const SHARED_KEY_HTML = String.raw`
<ul>
    <li><strong>Rating:</strong> Colley rating on a 0-1 scale using wins, losses, and ties (ties count as half-win/half-loss). Direct head-to-head weights are applied before adjustments. Optional enhancements: <em>Iterative Quality Adjustment</em> re-solves the Colley matrix using expected-outcome residuals so losses to elite teams are penalized less and upset wins are rewarded more; <em>Freeman Win Floor</em> guarantees every win earns minimum credit so expected wins are never worth nearly zero; <em>Massey Home-Field Advantage</em> gives road wins more credit and discounts road losses.</li>
    <li><strong>Schedule:</strong> Weighted opponent strength that highlights top results; the top five opponents receive weights of 7, 6, 5, 4, and 3, with credits tapering for the remaining schedule.</li>
    <li>
        <strong>Adj:</strong> Final adjusted rating after applying ordered rules. Indicators show why a team moved:
        <ol style="margin-top:5px; margin-bottom:5px; padding-left:20px;">
            <li class="league-only"><strong>League Position (<span class="adj-league-order-down" style="font-weight:bold;">Purple</span>):</strong> Enforces published league order once completion checks pass, moving higher league finishers above lower finishers without breaking head-to-head locks.</li>
            <li><strong>Head-to-Head Results (<span class="adj-five-set-win" style="font-weight:bold;">Green</span>):</strong> Direct wins can lift a team above an opponent. Split-series weight (default 0.4) softly separates evenly split matchups so the broader resume still decides the order.</li>
            <li><strong>Undefeated Anchors (<span class="adj-needs-adjustment" style="font-weight:bold;">Red</span>):</strong> Programs under the win threshold (12 wins for single-format sports) are held above their best victory; once they reach the cap they keep their position without further protection.</li>
        </ol>
        Colors match the table highlights so you can trace each adjustment.
    </li>
    <li>
        <strong>Badges:</strong>
        <ul style="margin-top: 6px; margin-bottom: 0; padding-left: 18px;">
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-crown toughest-schedule-icon crown" aria-hidden="true"></i>
                    </span>
                    <span>Crown (Gold): Undefeated, 6+ matches played</span>
                </div>
            </li>
            <li class="badge-silver">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-crown toughest-schedule-icon crown silver" aria-hidden="true"></i>
                    </span>
                    <span>Crown (Silver): Undefeated in Best-of-5 matches (may have losses in Bo3/1-set); receives undefeated anchor protection until 20 earned wins.</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-gem toughest-schedule-icon undisputed" aria-hidden="true"></i>
                    </span>
                    <span>Undisputed #1: Head-to-head wins over #2 and #3, no losses to any top-5 team, 6+ matches played.</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon gold" aria-hidden="true"></i>
                    </span>
                    <span><strong>#1 Toughest</strong> overall schedule (Gold) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon silver" aria-hidden="true"></i>
                    </span>
                    <span>2nd Toughest overall schedule (Silver) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon bronze" aria-hidden="true"></i>
                    </span>
                    <span>3rd Toughest overall schedule (Bronze) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon gold" aria-hidden="true"></i>
                    </span>
                    <span><strong>#1 Toughest</strong> outside-of-league schedule (Gold) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon silver" aria-hidden="true"></i>
                    </span>
                    <span>2nd Toughest outside-of-league schedule (Silver) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon bronze" aria-hidden="true"></i>
                    </span>
                    <span>3rd Toughest outside-of-league schedule (Bronze) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-regular fa-calendar-minus toughest-schedule-icon orange" aria-hidden="true"></i>
                    </span>
                    <span>All scheduled city section games are league games</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-balance-scale-left toughest-schedule-icon red" aria-hidden="true"></i>
                    </span>
                    <span>Top 3 weakest schedule among the Top 25 teams</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-f toughest-schedule-icon red" aria-hidden="true" style="margin-left: 0; font-size: 0.75em;"></i><i class="fa-solid fa-f toughest-schedule-icon red" aria-hidden="true" style="margin-left: 1px; font-size: 0.75em;"></i>
                    </span>
                    <span>Team has forfeited a game</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-f toughest-schedule-icon green" aria-hidden="true" style="margin-left: 0; font-size: 0.75em;"></i><i class="fa-solid fa-f toughest-schedule-icon green" aria-hidden="true" style="margin-left: 1px; font-size: 0.75em;"></i>
                    </span>
                    <span>Team received an FF win from a much higher-ranked team (ranking-neutral flag)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-circle-exclamation league-warning-icon" aria-hidden="true"></i>
                    </span>
                    <span>League info incomplete (missing matches or standings still updating)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-not-equal league-tie-icon" aria-hidden="true"></i>
                    </span>
                    <span>Unresolved league tie or unresolved league results (league placement frozen until resolved)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-code-branch league-tiebreak-icon" aria-hidden="true"></i>
                    </span>
                    <span>League tiebreak resolved (blue = two-way tie, <span style="color:#7b2d8e; font-weight:600;">purple</span> = multi-way tie); hover for details.</span>
                </div>
            </li>
            <li class="unranked-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;" aria-hidden="true">&#x1F4C8;</span>
                    <span>Earned-wins badge for unranked teams (most/2nd/3rd non-forfeit wins so far)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" style="font-size: 0.85em;"></i>
                    </span>
                    <span>External link to team page (opens in a new tab)</span>
                </div>
            </li>
            <li class="volleyball-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-down-left-and-up-right-to-center toughest-schedule-icon teal" aria-hidden="true"></i>
                    </span>
                    <span>Clutch Sets: Most 25-23 set wins and/or 23-25 set losses (&gt;6 each)</span>
                </div>
            </li>
        </ul>
    </li>
    <li>
        <strong>MAdj (Combined Rating):</strong> A blended rating that combines the Tim Rankings adjusted rating with MaxPreps power ratings. The formula is:
        <code style="display:block; margin:6px 0 6px 10px; padding:4px 8px; background:#f5f5f5; border-radius:4px; font-size:0.9em;">
            MAdj = (Adj × Multiplier) + ((Power × Power Weight + Schedule × Schedule Weight) / 2)
        </code>
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>Adj:</strong> Tim Rankings adjusted rating (0-1 scale)</li>
            <li><strong>Multiplier:</strong> Scales the Adj rating (default: 20)</li>
            <li><strong>Power:</strong> MaxPreps power rating for the team</li>
            <li><strong>Schedule:</strong> MaxPreps schedule strength rating</li>
            <li><strong>Power/Schedule Weights:</strong> Control the influence of each MaxPreps metric (defaults: 0.7/0.3)</li>
        </ul>
        MAdj provides a cross-referenced rating that leverages both algorithmic rankings and MaxPreps data.
    </li>
    <li>
        <strong>Out Of Section Common Opponent (OOS CO) Boost:</strong> A rating adjustment applied when two closely-ranked teams have both played the same out-of-section opponent(s). This provides additional data points for comparing teams that don't have direct head-to-head results.
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>How it works:</strong> When 2+ section teams play the same out-of-section team, their performance against that common opponent is compared.</li>
            <li><strong>Threshold:</strong> Only applies to teams within a configurable rating gap (default: 2% or 0.02).</li>
            <li><strong>Boost Weight:</strong> The magnitude of the rating adjustment (default: 0.01).</li>
            <li><strong>Calculation:</strong> The team with the better record vs shared OOS opponents receives a small rating boost.</li>
        </ul>
        This helps differentiate between closely-ranked teams by using shared external opponents as an indirect comparison. OOS opponents appear in team tooltips and the Common Opponent Tracker (marked as "Outside Section").
    </li>
    <li>
        <strong>Unranked Teams:</strong> Teams are separated into two pools using a Quality-Win Pools algorithm:
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>Seeds:</strong> The top 25 teams from the prior year's final rankings serve as "seeds" (Tier 0). These anchor the quality chain.</li>
            <li><strong>Transitive Closure:</strong> The algorithm uses BFS (Breadth-First Search) to trace wins backwards from seeds. Teams that beat a seed become Tier 1; teams that beat Tier 1 become Tier 2, and so on.</li>
            <li><strong>Ranked Pool (Pool A):</strong> Any team with a win path to a seed (Tier 1+), plus the seeds themselves. These teams appear in the main rankings.</li>
            <li><strong>Unranked Pool (Pool B):</strong> Teams with no earned wins, or whose earned wins never connect to the seed chain. These appear in the "Unranked Teams" section.</li>
            <li><strong>Pool Movement:</strong> As the season progresses, teams move between pools dynamically. Beating anyone in Pool A pulls you into Pool A; if all your wins fall out of Pool A, you drop to Pool B.</li>
        </ul>
        This transitive quality system ensures rankings reflect meaningful wins that ultimately trace back to proven competition, rather than isolated wins against untested opponents.
    </li>
</ul>
  `.trim();

    const SOCCER_KEY_HTML = String.raw`
<ul>
    <li><strong>Rating:</strong> Colley rating on a 0-1 scale using wins, losses, and draws. Draws count as half-win/half-loss so unbeaten sides retain credit. Optional enhancements: <em>Iterative Quality Adjustment</em> re-solves the Colley matrix using expected-outcome residuals so losses to elite teams are penalized less and upset wins are rewarded more; <em>Freeman Win Floor</em> guarantees every win earns minimum credit so expected wins are never worth nearly zero; <em>Massey Home-Field Advantage</em> gives road wins more credit and discounts road losses.</li>
    <li><strong>Schedule:</strong> Weighted opponent strength highlighting the toughest five results (weights 7, 6, 5, 4, 3) with a tapered credit for the remaining slate.</li>
    <li><strong>League Points:</strong> Standings use 3 points for a win, 1 for a draw, and 0 for a loss. If teams finish level on points, tiebreakers apply in order: head-to-head points, higher adjusted rating (Adj), and overall league goal differential. Fully tied groups remain frozen.</li>
    <li>
        <strong>Adj:</strong> Final adjusted rating after ordered rules finish:
        <ol style="margin-top:5px; margin-bottom:5px; padding-left:20px;">
            <li class="league-only"><strong>League Position (<span class="adj-league-order-down" style="font-weight:bold;">Purple</span>):</strong> Locks in published league order once completion checks pass, keeping higher finishers ahead without breaking head-to-head wins.</li>
            <li><strong>Head-to-Head Results (<span class="adj-five-set-win" style="font-weight:bold;">Green</span>):</strong> Direct wins provide lift, with split results separated softly so the overall resume still matters.</li>
            <li><strong>Undefeated Anchors (<span class="adj-needs-adjustment" style="font-weight:bold;">Red</span>):</strong> Teams under the win threshold (12 for soccer) stay above their best victory until they hit the cap.</li>
        </ol>
        Colors match the table highlights so you can trace each adjustment.
    </li>
    <li>
        <strong>Badges:</strong>
        <ul style="margin-top: 6px; margin-bottom: 0; padding-left: 18px;">
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-crown toughest-schedule-icon crown" aria-hidden="true"></i>
                    </span>
                    <span>Crown (Gold): Undefeated, 6+ matches played</span>
                </div>
            </li>
            <li class="badge-silver">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-crown toughest-schedule-icon crown silver" aria-hidden="true"></i>
                    </span>
                    <span>Crown (Silver): Undefeated in Best-of-5 matches (may have losses in Bo3/1-set); receives undefeated anchor protection until 20 earned wins.</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-gem toughest-schedule-icon undisputed" aria-hidden="true"></i>
                    </span>
                    <span>Undisputed #1: Head-to-head wins over #2 and #3, no losses to any top-5 team, 6+ matches played.</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon gold" aria-hidden="true"></i>
                    </span>
                    <span><strong>#1 Toughest</strong> overall schedule (Gold) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon silver" aria-hidden="true"></i>
                    </span>
                    <span>2nd Toughest overall schedule (Silver) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon bronze" aria-hidden="true"></i>
                    </span>
                    <span>3rd Toughest overall schedule (Bronze) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon gold" aria-hidden="true"></i>
                    </span>
                    <span><strong>#1 Toughest</strong> outside-of-league schedule (Gold) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon silver" aria-hidden="true"></i>
                    </span>
                    <span>2nd Toughest outside-of-league schedule (Silver) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon bronze" aria-hidden="true"></i>
                    </span>
                    <span>3rd Toughest outside-of-league schedule (Bronze) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-regular fa-calendar-minus toughest-schedule-icon orange" aria-hidden="true"></i>
                    </span>
                    <span>All scheduled city section games are league games</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-balance-scale-left toughest-schedule-icon red" aria-hidden="true"></i>
                    </span>
                    <span>Top 3 weakest schedule among the Top 25 teams</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-f toughest-schedule-icon red" aria-hidden="true" style="margin-left: 0; font-size: 0.75em;"></i><i class="fa-solid fa-f toughest-schedule-icon red" aria-hidden="true" style="margin-left: 1px; font-size: 0.75em;"></i>
                    </span>
                    <span>Team has forfeited a game</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-f toughest-schedule-icon green" aria-hidden="true" style="margin-left: 0; font-size: 0.75em;"></i><i class="fa-solid fa-f toughest-schedule-icon green" aria-hidden="true" style="margin-left: 1px; font-size: 0.75em;"></i>
                    </span>
                    <span>Team received an FF win from a much higher-ranked team (ranking-neutral flag)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-circle-exclamation league-warning-icon" aria-hidden="true"></i>
                    </span>
                    <span>League info incomplete (missing matches or standings still updating)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-not-equal league-tie-icon" aria-hidden="true"></i>
                    </span>
                    <span>Unresolved league tie or unresolved league results (league placement frozen until resolved)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-code-branch league-tiebreak-icon" aria-hidden="true"></i>
                    </span>
                    <span>League tiebreak resolved (blue = two-way tie, <span style="color:#7b2d8e; font-weight:600;">purple</span> = multi-way tie); hover for details.</span>
                </div>
            </li>
            <li class="unranked-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;" aria-hidden="true">&#x1F4C8;</span>
                    <span>Earned-wins badge for unranked teams (most/2nd/3rd non-forfeit wins so far)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" style="font-size: 0.85em;"></i>
                    </span>
                    <span>External link to team page (opens in a new tab)</span>
                </div>
            </li>
        </ul>
    </li>
    <li>
        <strong>MAdj (Combined Rating):</strong> A blended rating that combines the Tim Rankings adjusted rating with MaxPreps power ratings. The formula is:
        <code style="display:block; margin:6px 0 6px 10px; padding:4px 8px; background:#f5f5f5; border-radius:4px; font-size:0.9em;">
            MAdj = (Adj × Multiplier) + ((Power × Power Weight + Schedule × Schedule Weight) / 2)
        </code>
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>Adj:</strong> Tim Rankings adjusted rating (0-1 scale)</li>
            <li><strong>Multiplier:</strong> Scales the Adj rating (default: 20)</li>
            <li><strong>Power:</strong> MaxPreps power rating for the team</li>
            <li><strong>Schedule:</strong> MaxPreps schedule strength rating</li>
            <li><strong>Power/Schedule Weights:</strong> Control the influence of each MaxPreps metric (defaults: 0.7/0.3)</li>
        </ul>
        MAdj provides a cross-referenced rating that leverages both algorithmic rankings and MaxPreps data.
    </li>
    <li>
        <strong>Out Of Section Common Opponent (OOS CO) Boost:</strong> A rating adjustment applied when two closely-ranked teams have both played the same out-of-section opponent(s). This provides additional data points for comparing teams that don't have direct head-to-head results.
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>How it works:</strong> When 2+ section teams play the same out-of-section team, their performance against that common opponent is compared.</li>
            <li><strong>Threshold:</strong> Only applies to teams within a configurable rating gap (default: 2% or 0.02).</li>
            <li><strong>Boost Weight:</strong> The magnitude of the rating adjustment (default: 0.01).</li>
            <li><strong>Calculation:</strong> The team with the better record vs shared OOS opponents receives a small rating boost.</li>
        </ul>
        This helps differentiate between closely-ranked teams by using shared external opponents as an indirect comparison. OOS opponents appear in team tooltips and the Common Opponent Tracker (marked as "Outside Section").
    </li>
    <li>
        <strong>Unranked Teams:</strong> Teams are separated into two pools using a Quality-Win Pools algorithm:
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>Seeds:</strong> The top 25 teams from the prior year's final rankings serve as "seeds" (Tier 0). These anchor the quality chain.</li>
            <li><strong>Transitive Closure:</strong> The algorithm uses BFS (Breadth-First Search) to trace wins backwards from seeds. Teams that beat a seed become Tier 1; teams that beat Tier 1 become Tier 2, and so on.</li>
            <li><strong>Ranked Pool (Pool A):</strong> Any team with a win path to a seed (Tier 1+), plus the seeds themselves. These teams appear in the main rankings.</li>
            <li><strong>Unranked Pool (Pool B):</strong> Teams with no earned wins, or whose earned wins never connect to the seed chain. These appear in the "Unranked Teams" section.</li>
            <li><strong>Pool Movement:</strong> As the season progresses, teams move between pools dynamically. Beating anyone in Pool A pulls you into Pool A; if all your wins fall out of Pool A, you drop to Pool B.</li>
        </ul>
        This transitive quality system ensures rankings reflect meaningful wins that ultimately trace back to proven competition, rather than isolated wins against untested opponents.
    </li>
</ul>
  `.trim();

    const BASKETBALL_KEY_HTML = String.raw`
<ul>
    <li><strong>Rating:</strong> Colley rating on a 0-1 scale using wins, losses, and ties (ties count as half-win/half-loss). Direct head-to-head weights are applied before adjustments. Optional enhancements: <em>Iterative Quality Adjustment</em> re-solves the Colley matrix using expected-outcome residuals so losses to elite teams are penalized less and upset wins are rewarded more; <em>Freeman Win Floor</em> guarantees every win earns minimum credit so expected wins are never worth nearly zero; <em>Massey Home-Field Advantage</em> gives road wins more credit and discounts road losses.</li>
    <li><strong>Schedule:</strong> Weighted opponent strength that highlights top results; the top five opponents receive weights of 7, 6, 5, 4, and 3, with credits tapering for the remaining schedule.</li>
    <li class="league-only"><strong>League Record:</strong> League standings sort by win percentage. Ties are broken by head-to-head results among tied league opponents, then by higher adjusted rating (Adj).</li>
    <li>
        <strong>Adj:</strong> Final adjusted rating after applying ordered rules. Indicators show why a team moved:
        <ol style="margin-top:5px; margin-bottom:5px; padding-left:20px;">
            <li class="league-only"><strong>League Position (<span class="adj-league-order-down" style="font-weight:bold;">Purple</span>):</strong> Enforces published league order once completion checks pass, moving higher league finishers above lower finishers without breaking head-to-head locks.</li>
            <li><strong>Head-to-Head Results (<span class="adj-five-set-win" style="font-weight:bold;">Green</span>):</strong> Direct wins can lift a team above an opponent. Split-series weight (default 0.4) softly separates evenly split matchups so the broader resume still decides the order.</li>
            <li><strong>Undefeated Anchors (<span class="adj-needs-adjustment" style="font-weight:bold;">Red</span>):</strong> Programs under the win threshold (12 wins for single-format sports) are held above their best victory; once they reach the cap they keep their position without further protection.</li>
        </ol>
        Colors match the table highlights so you can trace each adjustment.
    </li>
    <li>
        <strong>Badges:</strong>
        <ul style="margin-top: 6px; margin-bottom: 0; padding-left: 18px;">
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-crown toughest-schedule-icon crown" aria-hidden="true"></i>
                    </span>
                    <span>Crown (Gold): Undefeated, 6+ matches played</span>
                </div>
            </li>
            <li class="badge-silver">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-crown toughest-schedule-icon crown silver" aria-hidden="true"></i>
                    </span>
                    <span>Crown (Silver): Undefeated in Best-of-5 matches (may have losses in Bo3/1-set); receives undefeated anchor protection until 20 earned wins.</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-gem toughest-schedule-icon undisputed" aria-hidden="true"></i>
                    </span>
                    <span>Undisputed #1: Head-to-head wins over #2 and #3, no losses to any top-5 team, 6+ matches played.</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon gold" aria-hidden="true"></i>
                    </span>
                    <span><strong>#1 Toughest</strong> overall schedule (Gold) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon silver" aria-hidden="true"></i>
                    </span>
                    <span>2nd Toughest overall schedule (Silver) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-dumbbell toughest-schedule-icon bronze" aria-hidden="true"></i>
                    </span>
                    <span>3rd Toughest overall schedule (Bronze) - League, Non-League (CIFLA Teams Only)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon gold" aria-hidden="true"></i>
                    </span>
                    <span><strong>#1 Toughest</strong> outside-of-league schedule (Gold) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon silver" aria-hidden="true"></i>
                    </span>
                    <span>2nd Toughest outside-of-league schedule (Silver) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-earth-americas toughest-schedule-icon bronze" aria-hidden="true"></i>
                    </span>
                    <span>3rd Toughest outside-of-league schedule (Bronze) - Non-League Only (Including outside-of-section)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-regular fa-calendar-minus toughest-schedule-icon orange" aria-hidden="true"></i>
                    </span>
                    <span>All scheduled city section games are league games</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-balance-scale-left toughest-schedule-icon red" aria-hidden="true"></i>
                    </span>
                    <span>Top 3 weakest schedule among the Top 25 teams</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-f toughest-schedule-icon red" aria-hidden="true" style="margin-left: 0; font-size: 0.75em;"></i><i class="fa-solid fa-f toughest-schedule-icon red" aria-hidden="true" style="margin-left: 1px; font-size: 0.75em;"></i>
                    </span>
                    <span>Team has forfeited a game</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-f toughest-schedule-icon green" aria-hidden="true" style="margin-left: 0; font-size: 0.75em;"></i><i class="fa-solid fa-f toughest-schedule-icon green" aria-hidden="true" style="margin-left: 1px; font-size: 0.75em;"></i>
                    </span>
                    <span>Team received an FF win from a much higher-ranked team (ranking-neutral flag)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-circle-exclamation league-warning-icon" aria-hidden="true"></i>
                    </span>
                    <span>League info incomplete (missing matches or standings still updating)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-not-equal league-tie-icon" aria-hidden="true"></i>
                    </span>
                    <span>Unresolved league tie or unresolved league results (league placement frozen until resolved)</span>
                </div>
            </li>
            <li class="league-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-code-branch league-tiebreak-icon" aria-hidden="true"></i>
                    </span>
                    <span>League tiebreak resolved (blue = two-way tie, <span style="color:#7b2d8e; font-weight:600;">purple</span> = multi-way tie); hover for details.</span>
                </div>
            </li>
            <li class="unranked-only">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;" aria-hidden="true">&#x1F4C8;</span>
                    <span>Earned-wins badge for unranked teams (most/2nd/3rd non-forfeit wins so far)</span>
                </div>
            </li>
            <li>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="width:22px; display:inline-flex; justify-content:center;">
                        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" style="font-size: 0.85em;"></i>
                    </span>
                    <span>External link to team page (opens in a new tab)</span>
                </div>
            </li>
        </ul>
    </li>
    <li>
        <strong>MAdj (Combined Rating):</strong> A blended rating that combines the Tim Rankings adjusted rating with MaxPreps power ratings. The formula is:
        <code style="display:block; margin:6px 0 6px 10px; padding:4px 8px; background:#f5f5f5; border-radius:4px; font-size:0.9em;">
            MAdj = (Adj × Multiplier) + ((Power × Power Weight + Schedule × Schedule Weight) / 2)
        </code>
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>Adj:</strong> Tim Rankings adjusted rating (0-1 scale)</li>
            <li><strong>Multiplier:</strong> Scales the Adj rating (default: 20)</li>
            <li><strong>Power:</strong> MaxPreps power rating for the team</li>
            <li><strong>Schedule:</strong> MaxPreps schedule strength rating</li>
            <li><strong>Power/Schedule Weights:</strong> Control the influence of each MaxPreps metric (defaults: 0.7/0.3)</li>
        </ul>
        MAdj provides a cross-referenced rating that leverages both algorithmic rankings and MaxPreps data.
    </li>
    <li>
        <strong>Out Of Section Common Opponent (OOS CO) Boost:</strong> A rating adjustment applied when two closely-ranked teams have both played the same out-of-section opponent(s). This provides additional data points for comparing teams that don't have direct head-to-head results.
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>How it works:</strong> When 2+ section teams play the same out-of-section team, their performance against that common opponent is compared.</li>
            <li><strong>Threshold:</strong> Only applies to teams within a configurable rating gap (default: 2% or 0.02).</li>
            <li><strong>Boost Weight:</strong> The magnitude of the rating adjustment (default: 0.01).</li>
            <li><strong>Calculation:</strong> The team with the better record vs shared OOS opponents receives a small rating boost.</li>
        </ul>
        This helps differentiate between closely-ranked teams by using shared external opponents as an indirect comparison. OOS opponents appear in team tooltips and the Common Opponent Tracker (marked as "Outside Section").
    </li>
    <li>
        <strong>Unranked Teams:</strong> Teams are separated into two pools using a Quality-Win Pools algorithm:
        <ul style="margin-top:4px; margin-bottom:4px; padding-left:18px;">
            <li><strong>Seeds:</strong> The top 25 teams from the prior year's final rankings serve as "seeds" (Tier 0). These anchor the quality chain.</li>
            <li><strong>Transitive Closure:</strong> The algorithm uses BFS (Breadth-First Search) to trace wins backwards from seeds. Teams that beat a seed become Tier 1; teams that beat Tier 1 become Tier 2, and so on.</li>
            <li><strong>Ranked Pool (Pool A):</strong> Any team with a win path to a seed (Tier 1+), plus the seeds themselves. These teams appear in the main rankings.</li>
            <li><strong>Unranked Pool (Pool B):</strong> Teams with no earned wins, or whose earned wins never connect to the seed chain. These appear in the "Unranked Teams" section.</li>
            <li><strong>Pool Movement:</strong> As the season progresses, teams move between pools dynamically. Beating anyone in Pool A pulls you into Pool A; if all your wins fall out of Pool A, you drop to Pool B.</li>
        </ul>
        This transitive quality system ensures rankings reflect meaningful wins that ultimately trace back to proven competition, rather than isolated wins against untested opponents.
    </li>
</ul>
  `.trim();

    const SHARED_FLAWS_HTML = String.raw`
<ul>
    <li><strong>Unbalanced schedules:</strong> Programs that stay within a small pool of opponents can appear stronger or weaker than expected until more cross-league results arrive. Teams marked with <i class="fa-regular fa-calendar-minus toughest-schedule-icon orange" aria-hidden="true"></i> have only league games on their city section schedule.</li>
    <li><strong>Margin insensitivity:</strong> Rankings are win/loss driven—margin of victory is not rewarded beyond the match result.</li>
    <li><strong>Missing scores:</strong> Games not entered to MaxPreps limit the quality of schedule strength and head-to-head comparisons.</li>
    <li><strong>Seed chain gaps:</strong> The Quality-Win Pools algorithm requires a transitive win path to last year's Top 25. A team could beat several quality opponents, but if none of those opponents connect to the seed chain, the team remains in the Unranked pool despite appearing strong.</li>
    <li><strong>Early season volatility / small sample sizes:</strong> Rankings are inherently unstable in weeks 1-3 and for teams with fewer than 10 matches. A single result can dramatically shift positions when data is sparse; expect larger swings early that dampen as more games are played.</li>
    <li><strong>H2H cascade effects:</strong> One upset can trigger a chain reaction of rank swaps. When Team A beats Team B, the head-to-head magnet pulls A above B, which may then affect B's position relative to C, and so on—sometimes moving 4-5 teams from a single result.</li>
    <li><strong>Misleading records:</strong> Undefeated teams may be inflated if their wins came against weak or untested opponents. Conversely, winless teams who faced elite competition may be undervalued—their record doesn't reflect how competitive those matches were.</li>
</ul>
  `.trim();

    const SIMPLE_WEIGHT_VISIBILITY = {
        'weight-bo5': true,
        'weight-bo5-split': true,
        'weight-bo3': false,
        'weight-two': false,
        'weight-one': false,
        'weight-forfeit-credit': true,
        'weight-sos': true
    };

    const SIMPLE_WEIGHT_DEFAULTS = {
        'weight-bo5': 1.0,
        'weight-bo5-split': 1.0,
        'weight-bo3': 1.0,
        'weight-two': 1.0,
        'weight-one': 1.0,
        'weight-forfeit-credit': 0,
        'weight-sos': 0.2
    };

    function buildSimpleSportConfig({
        key,
        label,
        maxPrepsSegment,
        leagueSheetName = null,
        includeGenderInSheetName = true,
        allowedGenders = ['boys', 'girls']
    }) {
        const normalizedAllowedGenders = Array.isArray(allowedGenders)
            ? allowedGenders
                .map(gender => (String(gender || '').trim() || ''))
                .map(gender => gender.toLowerCase())
                .filter(Boolean)
            : [];
        const finalAllowedGenders = normalizedAllowedGenders.length
            ? normalizedAllowedGenders
            : ['boys', 'girls'];
        return {
            key,
            label,
            sheetName({ gender, year }) {
                const season = year === 'Current Year' ? 'Current Year' : year;
                return includeGenderInSheetName
                    ? `${label} ${gender} ${season}`
                    : `${label} ${season}`;
            },
            leagueSheetName() {
                return leagueSheetName || 'Leagues';
            },
            maxPrepsSportSegment: maxPrepsSegment,
            boysCurrentYearDisabled: false,
            supportsAlternateFormats: false,
            setDiffMultiplier: 0,
            wengLinAutoDefaultWeightedMatchCutoff: 6,
            wengLinWeightedMatchCutoff: 6,
            supportsLeagues: true,
            leagueMeetingsPerOpponent: 2,
            showUnrankedTable: true,
            weightDefaults: { ...SIMPLE_WEIGHT_DEFAULTS },
            weightVisibility: { ...SIMPLE_WEIGHT_VISIBILITY },
            weightLabels: {
                'weight-bo5': 'Head-to-head match weight:',
                'weight-bo5-split': 'Split Series Weight:',
                'weight-forfeit-credit': 'Forfeit Win Credit (ignored):',
                'weight-sos': 'Schedule Strength Weight:'
            },
            undefeatedThresholds: {
                perfect: 12,
                bo5: 12
            },
            allowedGenders: finalAllowedGenders,
            keyHtml: SHARED_KEY_HTML,
            flawsHtml: SHARED_FLAWS_HTML
        };
    }


    const soccerConfig = buildSimpleSportConfig({
        key: 'soccer',
        label: 'Soccer',
        maxPrepsSegment: 'soccer'
    });

    const basketballConfig = buildSimpleSportConfig({
        key: 'basketball',
        label: 'Basketball',
        maxPrepsSegment: 'basketball'
    });
    basketballConfig.weightDefaults = {
        ...basketballConfig.weightDefaults,
    };
    basketballConfig.weightLabels = {
        ...basketballConfig.weightLabels,
        'weight-bo5-split': 'Split Series Weight (draws/head-to-head parity):'
    };
    basketballConfig.keyHtml = BASKETBALL_KEY_HTML;
    basketballConfig.setDiffMultiplier = 0.02;
    basketballConfig.supportsPointDifferential = true;
    basketballConfig.pointDifferentialDefaults = {
        enabled: true,
        multiplier: 0.02
    };
    basketballConfig.playoffConfig = {
        divisions: ['OPEN', 'D1', 'D2', 'D3', 'D4', 'D5'],
        openSize: 8,
        defaultSizes: { D1: 16, D2: 16, D3: 16, D4: 16, D5: 16 },
        allowedSizes: [16, 18, 20, 22, 24]
    };
    basketballConfig.supportsSpotlightPointDiff = true;
    basketballConfig.spotlightPointDiffDefaults = {
        enabled: false,           // off by default for bball (already has blanket point diff)
        multiplier: 0.01,
        ratingThreshold: 0.08,
        cap: 0.015
    };
    basketballConfig.spotlightPointDiffMode = 'score';   // raw teamASets - teamBSets
    basketballConfig.spotlightPointDiffNormDivisor = 20;  // 20-pt game = fully dominant
    SPORT_CONFIGS.basketball = basketballConfig;

    const footballConfig = buildSimpleSportConfig({
        key: 'football',
        label: 'Football',
        maxPrepsSegment: 'football',
        includeGenderInSheetName: false,
        allowedGenders: ['boys']
    });
    footballConfig.setDiffMultiplier = 0.02;
    footballConfig.supportsPointDifferential = true;
    footballConfig.pointDifferentialDefaults = {
        enabled: true,
        multiplier: 0.02
    };
    footballConfig.pointDifferentialLabel = 'Point Diff Emphasis:';
    footballConfig.leagueMeetingsPerOpponent = 1;
    footballConfig.playoffConfig = {
        divisions: ['OPEN', 'D1', 'D2', 'D3'],
        openSize: 8,
        defaultSizes: { D1: 16, D2: 16, D3: 16 },
        allowedSizes: [16, 18, 20, 22, 24]
    };
    footballConfig.supportsSpotlightPointDiff = true;
    footballConfig.spotlightPointDiffDefaults = {
        enabled: false,
        multiplier: 0.01,
        ratingThreshold: 0.08,
        cap: 0.015
    };
    footballConfig.spotlightPointDiffMode = 'score';
    footballConfig.spotlightPointDiffNormDivisor = 21;    // 3-TD margin = fully dominant
    SPORT_CONFIGS.football = footballConfig;

    const flagFootballConfig = buildSimpleSportConfig({
        key: 'flag-football',
        label: 'Flag Football',
        maxPrepsSegment: 'flag-football',
        includeGenderInSheetName: false,
        allowedGenders: ['girls']
    });
    flagFootballConfig.setDiffMultiplier = 0.02;
    flagFootballConfig.supportsPointDifferential = true;
    flagFootballConfig.pointDifferentialDefaults = {
        enabled: true,
        multiplier: 0.02
    };
    flagFootballConfig.pointDifferentialLabel = 'Point Diff Emphasis:';
    flagFootballConfig.leagueMeetingsPerOpponent = 1;
    flagFootballConfig.playoffConfig = {
        divisions: ['OPEN', 'D1', 'D2', 'D3'],
        openSize: 8,
        defaultSizes: { D1: 16, D2: 16, D3: 16 },
        allowedSizes: [16, 18, 20, 22, 24]
    };
    flagFootballConfig.supportsSpotlightPointDiff = true;
    flagFootballConfig.spotlightPointDiffDefaults = {
        enabled: false,
        multiplier: 0.01,
        ratingThreshold: 0.08,
        cap: 0.015
    };
    flagFootballConfig.spotlightPointDiffMode = 'score';
    flagFootballConfig.spotlightPointDiffNormDivisor = 21;
    SPORT_CONFIGS['flag-football'] = flagFootballConfig;


    const baseballConfig = buildSimpleSportConfig({
        key: 'baseball',
        label: 'Baseball',
        maxPrepsSegment: 'baseball',
        includeGenderInSheetName: false,
        allowedGenders: ['boys']
    });
    baseballConfig.playoffConfig = {
        divisions: ['OPEN', 'D1', 'D2', 'D3', 'D4'],
        openSize: 8,
        defaultSizes: { D1: 16, D2: 16, D3: 16, D4: 16 },
        allowedSizes: [16, 18, 20, 22, 24]
    };
    SPORT_CONFIGS.baseball = baseballConfig;

    const softballConfig = buildSimpleSportConfig({
        key: 'softball',
        label: 'Softball',
        maxPrepsSegment: 'softball',
        includeGenderInSheetName: false,
        allowedGenders: ['girls']
    });
    softballConfig.boysCurrentYearDisabled = true;
    softballConfig.playoffConfig = {
        divisions: ['OPEN', 'D1', 'D2', 'D3', 'D4'],
        openSize: 8,
        defaultSizes: { D1: 16, D2: 16, D3: 16, D4: 16 },
        allowedSizes: [16, 18, 20, 22, 24]
    };
    SPORT_CONFIGS.softball = softballConfig;

    const beachVolleyballConfig = buildSimpleSportConfig({
        key: 'beach-volleyball',
        label: 'Beach Volleyball',
        maxPrepsSegment: 'beach-volleyball',
        includeGenderInSheetName: false,
        allowedGenders: ['girls']
    });
    beachVolleyballConfig.supportsLeagues = false;
    beachVolleyballConfig.showUnrankedTable = false;
    beachVolleyballConfig.boysCurrentYearDisabled = true;
    SPORT_CONFIGS['beach-volleyball'] = beachVolleyballConfig;

    soccerConfig.weightDefaults = {
        ...soccerConfig.weightDefaults,
        'weight-bo5-split': 0.4
    };
    soccerConfig.weightLabels = {
        ...soccerConfig.weightLabels,
        'weight-bo5-split': 'Split Series Weight (draws/head-to-head parity):'
    };
    soccerConfig.keyHtml = SOCCER_KEY_HTML;
    soccerConfig.playoffConfig = {
        divisions: ['OPEN', 'D1', 'D2', 'D3', 'D4'],
        openSize: 8,
        defaultSizes: { D1: 16, D2: 16, D3: 16, D4: 16 },
        allowedSizes: [16, 18, 20, 22, 24]
    };
    SPORT_CONFIGS.soccer = soccerConfig;

    // Set volleyball keyHtml/flawsHtml now that the constants are defined
    SPORT_CONFIGS.volleyball.keyHtml = SHARED_KEY_HTML;
    SPORT_CONFIGS.volleyball.flawsHtml = SHARED_FLAWS_HTML;


    function getSportConfig(key) {
        return SPORT_CONFIGS[key] || SPORT_CONFIGS.volleyball;
    }

    window.SPORT_CONFIGS = SPORT_CONFIGS;
    window.SHOW_PLAYOFFS_TAB = false;
    window.DEFAULT_SPORT_KEY = 'volleyball';
    window.SPORT_YEAR_OPTIONS = YEAR_OPTIONS.slice();
    window.getSportConfig = getSportConfig;
})();
