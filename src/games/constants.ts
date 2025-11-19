import { GuildMember } from "discord.js";
import { GameState, GameType } from "./types";
import AbstractGame from "./abstract-game";
import ClassicGame from "./classic";
import MazeGame from "./maze";
import IslandGame from "./island";
import MasterpieceGame from "./masterpiece";
import RiskGame from "./risk";
import CandyLandGame from "./candyland";
import ArenaGame from "./arena";
import Masterpiece2Game from "./masterpiece2";

export const GAME_TYPE_NAMES: Record<GameType, string> = {
    CLASSIC: 'Classic',
    MAZE: 'Maze Dungeon Crawler',
    ISLAND: 'Island Survivor',
    MASTERPIECE: 'Masterpiece (Legacy)',
    MASTERPIECE_2: 'Masterpiece 2: Auctionhouse Anarchy',
    RISK: 'Risk',
    CANDYLAND: 'Cute Scott\'s Candy Kingdom',
    ARENA: 'Bob\'s Arena (INCOMPLETE)'
};

export const GAME_DESCRIPTIONS: Record<GameType, string> = {
    CLASSIC: 'Basic GMBR with cheer/take/peek',
    MAZE: 'The labyrinth of clouds',
    ISLAND: 'Elimination by voting players off the island',
    MASTERPIECE: 'Art auction with random pieces and values',
    MASTERPIECE_2: 'Art auction with user-submitted pieces and crazy items',
    RISK: 'Board game of Risk over a map of Newport',
    CANDYLAND: 'RNG-heavy Candyland knockoff',
    ARENA: 'DO NOT RESEARCH'
};

// These games should NOT be played (and thus should not be an option when voting)
const RETIRED_GAMES: GameType[] = ['MASTERPIECE', 'ARENA'];

export const GAME_FACTORIES: Record<GameType, (members: GuildMember[], season: number) => AbstractGame<GameState>> = {
    CLASSIC: (members, season) => {
        const month = new Date().getMonth();
        return ClassicGame.create(members, season, (month === 8 || month === 9) || undefined);
    },
    MAZE: (members, season) => {
        return MazeGame.createOrganicBest(members, season, { attempts: 20, rows: 43, columns: 19, minNaive: 90 });
    },
    ISLAND: (members, season) => {
        return IslandGame.create(members, season);
    },
    MASTERPIECE: (members, season) => {
        return MasterpieceGame.create(members, season);
    },
    MASTERPIECE_2: (members, season) => {
        return Masterpiece2Game.create(members, season);
    },
    RISK: (members, season) => {
        return RiskGame.create(members, season);
    },
    CANDYLAND: (members, season) => {
        return CandyLandGame.create(members, season);
    },
    ARENA: (members, season) => {
        return ArenaGame.create(members, season);
    }
};

export const GAME_TYPES: GameType[] = Object.keys(GAME_TYPE_NAMES) as GameType[];
export const PLAYABLE_GAME_TYPES: GameType[] = GAME_TYPES.filter(t => !RETIRED_GAMES.includes(t));