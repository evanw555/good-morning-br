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

export const GAME_TYPE_NAMES: Record<GameType, string> = {
    CLASSIC: 'Classic',
    MAZE: 'Maze Dungeon Crawler',
    ISLAND: 'Island Survivor',
    MASTERPIECE: 'Masterpiece Art Auction',
    RISK: 'Risk',
    CANDYLAND: 'Cute Scott\'s Candy Kingdom',
    ARENA: 'Bob\'s Arena (INCOMPLETE)'
};

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