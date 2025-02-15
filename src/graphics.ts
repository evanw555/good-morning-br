
import canvas, { Canvas } from 'canvas';
import { Snowflake } from 'discord.js';
import GoodMorningState from './state';
import { Medals } from './types';

import imageLoader from './image-loader';
import { getNumberOfDaysSince, getTextLabel, joinCanvasesHorizontal, resize } from 'evanw555.js';

// TODO: This logic is horrible, please clean it up
// TODO: Can we collapse this with the classic game render logic?
export async function renderCasualLeaderboard(state: GoodMorningState, medals: Record<Snowflake, Medals>): Promise<Buffer> {
    const COLOR_SKY = 'rgba(100,157,250,1)';
    const COLOR_BAR_CONTAINER = 'rgb(221,231,239)';

    // Start by loading the header image, then use that to determine the total dimensions
    const headerImage = await imageLoader.loadImage('assets/classic/header-classic.png');

    const HEADER_HEIGHT = 200;
    const WIDTH = (headerImage.width / headerImage.height) * HEADER_HEIGHT;

    const BAR_HEIGHT = 36;
    const AVATAR_HEIGHT = BAR_HEIGHT;
    const BAR_PADDING = 3;
    const BAR_SPACING = BAR_PADDING * 1.5;
    const BASE_MARGIN = BAR_HEIGHT / 2;
    const BAR_WIDTH = WIDTH - (2 * BASE_MARGIN) - AVATAR_HEIGHT - BAR_SPACING;
    const INNER_BAR_WIDTH = BAR_WIDTH - (BAR_PADDING * 2);
    // TODO (2.0): This isn't really relevant anymore because there's no longer a season goal
    const SEASON_GOAL = 100;
    const PIXELS_PER_POINT = INNER_BAR_WIDTH / SEASON_GOAL;
    const LOWEST_SCORE = state.getMinPoints();
    const MARGIN = Math.max(BASE_MARGIN, PIXELS_PER_POINT * Math.abs(Math.min(LOWEST_SCORE, 0)) - (2 * BAR_PADDING + AVATAR_HEIGHT));
    const BASE_BAR_X = MARGIN + AVATAR_HEIGHT + BAR_SPACING;
    // const WIDTH = BASE_BAR_X + BAR_WIDTH + MARGIN;
    const HEIGHT = HEADER_HEIGHT + state.getNumPlayers() * (BAR_HEIGHT + BAR_SPACING) + MARGIN - BAR_SPACING;
    const c = canvas.createCanvas(WIDTH, HEIGHT);
    const context = c.getContext('2d');

    // Fill the solid background
    context.fillStyle = COLOR_SKY;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Draw the header image
    context.drawImage(headerImage, 0, 0, WIDTH, HEADER_HEIGHT);

    // Fetch all user display names
    const orderedUserIds: string[] = state.getOrderedPlayers();

    // Load medal images
    const rank1Image = await imageLoader.loadImage('assets/rank1.png');
    const rank2Image = await imageLoader.loadImage('assets/rank2.png');
    const rank3Image = await imageLoader.loadImage('assets/rank3.png');
    const rankLastImage = await imageLoader.loadImage('assets/ranklast.png');

    // Write the header text
    context.fillStyle = COLOR_BAR_CONTAINER;
    const TITLE_FONT_SIZE = Math.floor(WIDTH / 25);
    context.font = `${TITLE_FONT_SIZE}px sans-serif`;
    if (state.isSeasonGoalReached()) {
        const winnerName: string = state.getPlayerDisplayName(orderedUserIds[0]);
        // `Celebrating the end of season ${state.getSeasonNumber()}\n   ${state.getSeasonStartedOn()} - ${getTodayDateString()}\n      Congrats, ${winnerName}!`
        context.fillText(`Celebrating the end of the season\n   Congrats, ${winnerName}!`,
            WIDTH * 0.33,
            HEADER_HEIGHT * 5 / 16);
    } else {
        context.fillText(`We're ${getNumberOfDaysSince(state.getSeasonStartedOn())} days into season ${state.getSeasonNumber()}\n  What a blessed experience!`, WIDTH * 0.33, HEADER_HEIGHT * 7 / 16);
    }

    let textInsideBar = true;
    for (let i = 0; i < orderedUserIds.length; i++) {
        const userId: Snowflake = orderedUserIds[i];
        // const displayName = options?.showMultiplier ? state.getPlayerDisplayNameWithMultiplier(userId) : state.getPlayerDisplayName(userId);
        const displayName = state.getPlayerDisplayName(userId);
        const baseY = HEADER_HEIGHT + i * (BAR_HEIGHT + BAR_SPACING);

        // Draw the avatar container
        context.fillStyle = COLOR_BAR_CONTAINER;
        context.fillRect(MARGIN, baseY, AVATAR_HEIGHT, AVATAR_HEIGHT);
        // Draw the player's avatar
        const avatarImage = await imageLoader.loadAvatar(userId, 64);
        context.drawImage(avatarImage, MARGIN + BAR_PADDING, baseY + BAR_PADDING, AVATAR_HEIGHT - (BAR_PADDING * 2), AVATAR_HEIGHT - (BAR_PADDING * 2));

        // Determine the bar's actual rendered width (may be negative, but clip to prevent it from being too large)
        const actualBarWidth = Math.min(state.getPlayerPoints(userId), SEASON_GOAL) * PIXELS_PER_POINT;

        // Draw the bar container
        context.fillRect(BASE_BAR_X, baseY, BAR_WIDTH, BAR_HEIGHT);

        // Draw the actual bar using a hue corresponding to the user's rank
        const hue = 256 * (orderedUserIds.length - i) / orderedUserIds.length;
        context.fillStyle = `hsl(${hue},50%,50%)`;
        context.fillRect(BASE_BAR_X + BAR_PADDING,
            baseY + BAR_PADDING,
            actualBarWidth,
            BAR_HEIGHT - (BAR_PADDING * 2));

        const textHeight = BAR_HEIGHT - 4 * BAR_PADDING;
        // Must set the font before measuring the width
        context.font = `${textHeight}px sans-serif`;
        const textWidth = context.measureText(displayName).width;

        // If the text for this user no longer fits in the bar, place the text after the bar for all remaining entries
        if (textInsideBar) {
            textInsideBar = textWidth * 1.2 < actualBarWidth;
        }

        // Write the user's display name (with a "shadow")
        const textX = BASE_BAR_X + BAR_PADDING * 2 + (textInsideBar ? 0 : Math.max(actualBarWidth, 0));
        context.fillStyle = `rgba(0,0,0,.4)`;
        context.fillText(displayName, textX, baseY + 0.7 * BAR_HEIGHT);
        context.fillStyle = textInsideBar ? 'white' : 'BLACKISH';
        context.fillText(displayName, textX + 1, baseY + 0.7 * BAR_HEIGHT + 1);

        // Draw the number of points to the right of the name
        context.font = `${textHeight * .6}px sans-serif`;
        context.fillText(`${Math.floor(state.getPlayerPoints(userId))}`, textX + textWidth + (1.5 * BAR_PADDING), baseY + 0.7 * BAR_HEIGHT);

        // Draw medals for this user
        if (medals && medals[userId]) {
            const iconHeight = BAR_HEIGHT - 2 * BAR_PADDING;
            const overlays: (Canvas | canvas.Image)[] = [];

            const numGolds = medals[userId].gold ?? 0;
            if (numGolds > 0) {
                overlays.push(resize(rank1Image, { height: iconHeight }));
            }
            if (numGolds > 1) {
                overlays.push(getTextLabel(`x${numGolds}`, iconHeight * 0.6, iconHeight * 0.6, { style: 'BLACKISH', align: 'left' }));
            }

            const numSilvers = medals[userId].silver ?? 0;
            if (numSilvers > 0) {
                overlays.push(resize(rank2Image, { height: iconHeight }));
            }
            if (numSilvers > 1) {
                overlays.push(getTextLabel(`x${numSilvers}`, iconHeight * 0.6, iconHeight * 0.6, { style: 'BLACKISH', align: 'left' }));
            }

            const numBronzes = medals[userId].bronze ?? 0;
            if (numBronzes > 0) {
                overlays.push(resize(rank3Image, { height: iconHeight }));
            }
            if (numBronzes > 1) {
                overlays.push(getTextLabel(`x${numBronzes}`, iconHeight * 0.6, iconHeight * 0.6, { style: 'BLACKISH', align: 'left' }));
            }

            const overlay = joinCanvasesHorizontal(overlays, { spacing: BAR_PADDING, align: 'bottom' });
            context.drawImage(overlay, WIDTH - MARGIN - BAR_PADDING - overlay.width, baseY + BAR_PADDING);
        }
    }

    return c.toBuffer();
}