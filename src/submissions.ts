import { Snowflake } from "discord.js";
import { AnonymousSubmission, AnonymousSubmissionsPhase, RawAnonymousSubmissionsState } from "./types";
import { getRankString, naturalJoin, toFixed } from "evanw555.js";

declare interface AnonymousSubmissionVotingResult {
    code: string,
    rank: number,
    tied: boolean,
    userId: Snowflake,
    submission: AnonymousSubmission,
    breakdown: number[],
    breakdownString: string,
    medalsString: string,
    /** Raw score of this submission, as determined by the number and tiers of votes for it. */
    score: number,
    /**
     * Difference in score between this submission and the one ranked below it.
     * If tied, the margins of all the tied submissions should be the same, compared against the one ranked below them.
     * The lowest ranked submission should have a margin of zero.
     */
    margin: number,
    noVotes: boolean,
    disqualified: boolean,
    forfeited: boolean
}

export class AnonymousSubmissionsState {
    // Add 0.1 to break ties using total number of votes, 0.01 to ultimately break ties with golds
    static readonly GOLD_VOTE_VALUE = 3.11;
    static readonly SILVER_VOTE_VALUE = 2.1;
    static readonly BRONZE_VOTE_VALUE = 1.1;
    private static readonly VOTE_VALUES: number[] = [
        AnonymousSubmissionsState.GOLD_VOTE_VALUE,
        AnonymousSubmissionsState.SILVER_VOTE_VALUE,
        AnonymousSubmissionsState.BRONZE_VOTE_VALUE
    ];

    private readonly data: RawAnonymousSubmissionsState;

    constructor(data: RawAnonymousSubmissionsState) {
        this.data = data;
    }

    getPrompt(): string {
        return this.data.prompt;
    }

    getPhase(): AnonymousSubmissionsPhase {
        return this.data.phase;
    }

    setPhase(phase: AnonymousSubmissionsPhase) {
        this.data.phase = phase;
    }

    isSubmissionsPhase(): boolean {
        return this.data.phase === 'submissions';
    }

    isVotingPhase(): boolean {
        return this.data.phase === 'voting';
    }

    getSubmissions(): Record<Snowflake, AnonymousSubmission> {
        return this.data.submissions;
    }

    getSubmissionForUser(userId: Snowflake): AnonymousSubmission {
        return this.data.submissions[userId];
    }

    getNumSubmissions(): number {
        return Object.keys(this.data.submissions).length;
    }

    addSubmission(userId: Snowflake, submission: AnonymousSubmission) {
        this.data.submissions[userId] = submission;
    }

    getSubmissionsOwnersByCode(): Record<string, Snowflake> {
        return this.data.submissionOwnersByCode;
    }

    setSubmissionOwnerByCode(code: string, userId: Snowflake) {
        this.data.submissionOwnersByCode[code] = userId;
    }

    getOwnerOfSubmission(code: string): Snowflake {
        return this.data.submissionOwnersByCode[code];
    }

    getSubmissionCodes(): string[] {
        return Object.keys(this.data.submissionOwnersByCode);
    }

    getValidSubmissionCodes(): string[] {
        return this.getSubmissionCodes().filter(code => !this.isCodeDisqualified(code));
    }

    getDisqualifiedSubmissionCodes(): string[] {
        return this.getSubmissionCodes().filter(code => this.isCodeDisqualified(code));
    }

    isValidSubmissionCode(code: string): boolean {
        return code in this.data.submissionOwnersByCode;
    }

    getVotes(): Record<Snowflake, string[]> {
        return this.data.votes;
    }

    getSubmitterVotes(): Record<Snowflake, string[]> {
        const submitterVotes: Record<Snowflake, string[]> = {};
        for (const [userId, _votes] of Object.entries(this.getVotes())) {
            if (this.isSubmitter(userId)) {
                submitterVotes[userId] = _votes;
            }
        }
        return submitterVotes;
    }

    getAudienceVotes(): Record<Snowflake, string[]> {
        const audienceVotes: Record<Snowflake, string[]> = {};
        for (const [userId, _votes] of Object.entries(this.getVotes())) {
            if (!this.isSubmitter(userId)) {
                audienceVotes[userId] = _votes;
            }
        }
        return audienceVotes;
    }

    getAudienceVoters(): Snowflake[] {
        return Object.keys(this.getAudienceVotes());
    }

    getForfeiters(): Snowflake[] {
        return this.data.forfeiters;
    }

    hasUserForfeited(userId: Snowflake): boolean {
        return this.data.forfeiters.includes(userId);
    }

    addForfeiter(userId: Snowflake) {
        this.data.forfeiters.push(userId);
    }

    getRootSubmissionMessage(): Snowflake {
        if (!this.data.rootSubmissionMessage) {
            throw new Error('The root submission message ID doesn\'t exist!');
        }
        return this.data.rootSubmissionMessage;
    }

    setRootSubmissionMessage(messageId: Snowflake) {
        this.data.rootSubmissionMessage = messageId;
    }

    hasRootSubmissionMessage(): boolean {
        return this.data.rootSubmissionMessage !== undefined;
    }

    getSelectSubmissionsMessage(): Snowflake | undefined {
        return this.data.selectSubmissionMessage;
    }

    hasUserVoted(userId: Snowflake): boolean {
        return userId in this.data.votes;
    }

    setVote(userId: Snowflake, codes: string[]) {
        this.data.votes[userId] = codes;
    }

    getSubmitters(): Snowflake[] {
        return Object.keys(this.data.submissions);
    }

    isSubmitter(userId: Snowflake): boolean {
        return userId in this.data.submissions;
    }

    /**
     * Get the list of all users who have sent in a submission, yet haven't voted and haven't forfeited.
     * Even users on probation will be considered deadbeats, despite their vote not being required to satisfy "have all submitters voted".
     */
    getDeadbeats(): Snowflake[] {
        return this.getSubmitters()
            // Users who haven't forfeited...
            .filter(userId => !this.hasUserForfeited(userId))
            // And who haven't voted...
            .filter(userId => !this.hasUserVoted(userId));
    }

    hasDeadbeats(): boolean {
        return this.getDeadbeats().length > 0;
    }

    getNumDeadbeats(): number {
        return this.getDeadbeats().length;
    }

    isUserDeadbeat(userId: Snowflake): boolean {
        return this.getDeadbeats().includes(userId);
    }

    isCodeDisqualified(code: string): boolean {
        return this.isUserDeadbeat(this.getOwnerOfSubmission(code));
    }

    private computeAudienceVote(): string[] {
        return this.computeScores(this.getAudienceVotes())
            // Only include results that had any votes at all
            .filter(result => !result.noVotes)
            // Get just the first 0-3 codes
            .map(result => result.code)
            .slice(0, 3);
    }

    computeVoteResults(): { results: AnonymousSubmissionVotingResult[], audienceVote: string[], scoringDetailsString: string } {
        const effectiveVotes: Record<Snowflake, string[]> = this.getSubmitterVotes();
        const audienceVote = this.computeAudienceVote();
        effectiveVotes['$AUDIENCE'] = audienceVote;
        const results = this.computeScores(effectiveVotes);
        const scoringDetailsString = AnonymousSubmissionsState.getScoringDetailsString(results);
        return { results, audienceVote, scoringDetailsString };
    }

    private computeScores(votes: Record<Snowflake, string[]>): AnonymousSubmissionVotingResult[] {
        // First, tally the votes and compute the scores
        const scores: Record<string, number> = {}; // Map (submission code : points)
        const breakdown: Record<string, number[]> = {};
        const gotVotes: Set<string> = new Set();
        // Prime both maps (some submissions may get no votes)
        for (const code of this.getSubmissionCodes()) {
            // Prime with a base score to ultimately break ties based on previous GMBR wins
            scores[code] = 0;
            breakdown[code] = [0, 0, 0];
        }

        // Now, tally the actual scores and breakdowns
        for (const codes of Object.values(votes)) {
            codes.forEach((code, i) => {
                scores[code] = toFixed(scores[code] + (AnonymousSubmissionsState.VOTE_VALUES[i] ?? 0), 3);
                // Take note of the breakdown
                breakdown[code][i]++;
                // Note that this code got votes
                gotVotes.add(code);
            });
        }

        // Adjust the disqualified scores to place them at the end of the results list
        const disqualifiedCodes = this.getDisqualifiedSubmissionCodes();
        for (const code of disqualifiedCodes) {
            scores[code] = -1;
        }

        // Sort the codes by computed score (exclude submissions from those who didn't vote)
        const allCodesSorted: string[] = this.getSubmissionCodes();
        allCodesSorted.sort((x, y) => scores[y] - scores[x]);

        // Compute the final results (without ties)
        const results = allCodesSorted.map((code, i) => ({
            code,
            rank: i + 1,
            userId: this.getOwnerOfSubmission(code),
            submission: this.getSubmissionForUser(this.getOwnerOfSubmission(code)),
            breakdown: breakdown[code],
            breakdownString: AnonymousSubmissionsState.toBreakdownString(breakdown[code]),
            medalsString: AnonymousSubmissionsState.toMedalsString(breakdown[code]),
            score: scores[code],
            noVotes: !gotVotes.has(code),
            disqualified: this.isCodeDisqualified(code),
            forfeited: this.hasUserForfeited(this.getOwnerOfSubmission(code)),
            // Placeholder values filled in next loops, since they're relative
            tied: false,
            margin: 0,
        }));

        // Update entries with relative info
        for (let i = 1; i < results.length; i++) {
            const current = results[i];
            const previous = results[i - 1];
            // Compute the score for the previous submission
            previous.margin = previous.score - current.score;
            // If the score is the same, count these as a tie and assign the same rank
            if (current.score === previous.score) {
                current.rank = previous.rank;
                current.tied = true;
                previous.tied = true;
                // Also copy over the margin, since tied submissions should have the same margin value
                current.margin = previous.margin;
            }
        }

        // Return the final result
        return results;
    }

    private static getScoringDetailsString(results: AnonymousSubmissionVotingResult[]): string {
        return results.map((r) => {
            const userId = r.userId;
            const code = r.code;
            // TODO: Including margin for now to ensure it works properly. Remove after testing this out
            if (r.disqualified) {
                return `**DQ**: ${code} ~~<@${userId}>~~ \`${r.medalsString}=${r.score} (Δ${r.margin})\``;
            } else if (r.forfeited) {
                return `**${getRankString(r.rank)}(F)**: ${code} ~~<@${userId}>~~ \`${r.medalsString}=${r.score} (Δ${r.margin})\``;
            } else {
                return `**${getRankString(r.rank)}**: ${code} <@${userId}> \`${r.medalsString}=${r.score} (Δ${r.margin})\``;
            }
        }).join('\n');
    }

    private static toBreakdownString(breakdown: number[]): string {
        const items: string[] = [];
        const types: string[] = ['gold', 'silver', 'bronze'];
        for (let i = 0; i < 3; i++) {
            const n = breakdown[i];
            if (n) {
                items.push(`**${n}** ${types[i]} vote` + (n === 1 ? '' : 's'));
            }
        }
        return naturalJoin(items) || 'no votes';
    }

    private static toMedalsString(breakdown: number[]): string {
        return ('🥇'.repeat(breakdown[0]) + '🥈'.repeat(breakdown[1]) + '🥉'.repeat(breakdown[2])) || '🌚';
    }

    static getVotingFormulaString(): string {
        return `(\`score = ${AnonymousSubmissionsState.GOLD_VOTE_VALUE}🥇 `
            + `+ ${AnonymousSubmissionsState.SILVER_VOTE_VALUE}🥈 `
            + `+ ${AnonymousSubmissionsState.BRONZE_VOTE_VALUE}🥉\`)`
    }
}
