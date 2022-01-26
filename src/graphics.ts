import canvas from 'canvas';
import { Snowflake } from 'discord.js';
import { Medals, Season } from "./types.js";
import { getOrderedPlayers_old } from './util.js';

// TODO: This logic is horrible, please clean it up
export async function createSeasonResultsImage(season: Season, medals: Record<Snowflake, Medals>, getDisplayName: (userId: Snowflake) => Promise<string>): Promise<Buffer> {
    const HEADER_HEIGHT = 150;
    const BAR_WIDTH = 735;
    const BAR_HEIGHT = 36;
    const BAR_PADDING = 3;
    const INNER_BAR_WIDTH = BAR_WIDTH - (BAR_PADDING * 2);
    const BAR_SPACING = BAR_PADDING * 1.5;
    const PIXELS_PER_POINT = INNER_BAR_WIDTH / season.goal;
    const LOWEST_SCORE = Math.min(...Object.values(season.points));
    const MARGIN = Math.max(BAR_HEIGHT / 2, BAR_PADDING + PIXELS_PER_POINT * Math.abs(Math.min(LOWEST_SCORE, 0)));
    const WIDTH = BAR_WIDTH + 2 * MARGIN;
    const HEIGHT = HEADER_HEIGHT + Object.keys(season.points).length * (BAR_HEIGHT + BAR_SPACING) + MARGIN - BAR_SPACING;
    const c = canvas.createCanvas(WIDTH, HEIGHT);
    const context = c.getContext('2d');

    // Fill the blue sky background
    context.fillStyle = 'rgba(100,157,250,1)';
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Fetch all user display names
    const orderedUserIds: string[] = getOrderedPlayers_old(season.points);
    const userDisplayNames = {};
    for (let i = 0; i < orderedUserIds.length; i++) {
        const userId = orderedUserIds[i];
        let displayName;
        try {
            displayName = await getDisplayName(userId);
        } catch (err) {
            displayName = `User ${userId}`;
        }
        userDisplayNames[userId] = displayName;
    }

    // Load medal images
    const rank1Image = await canvas.loadImage('assets/rank1.png');
    const rank2Image = await canvas.loadImage('assets/rank2.png');
    const rank3Image = await canvas.loadImage('assets/rank3.png');
    const rankLastImage = await canvas.loadImage('assets/ranklast.png');

    // Draw the smiling sun graphic
    const sunImage = await canvas.loadImage('assets/sun3.png');
    const sunHeight = HEADER_HEIGHT + BAR_HEIGHT;
    const sunWidth = sunHeight * sunImage.width / sunImage.height;
    context.drawImage(sunImage, 0, 0, sunWidth, sunHeight);

    // Write the header text
    context.fillStyle = 'rgb(221,231,239)';
    const TITLE_FONT_SIZE = Math.floor(HEADER_HEIGHT / 4);
    context.font = `${TITLE_FONT_SIZE}px sans-serif`;
    context.fillText(`Celebrating the end of season ${season.season}\n   ${season.startedOn} - ${season.finishedOn}\n      Congrats, ${userDisplayNames[orderedUserIds[0]]}!`,
        sunWidth * .7,
        HEADER_HEIGHT * 5 / 16);

    let textInsideBar = true;
    for (let i = 0; i < orderedUserIds.length; i++) {
        const userId = orderedUserIds[i];
        const displayName = userDisplayNames[userId];
        const baseY = HEADER_HEIGHT + i * (BAR_HEIGHT + BAR_SPACING);

        // Determine the bar's actual rendered width (may be negative, but clip to prevent it from being too large)
        const actualBarWidth = Math.min(season.points[userId], season.goal) * PIXELS_PER_POINT;

        // Draw the bar container
        context.fillStyle = 'rgb(221,231,239)';
        context.fillRect(MARGIN, baseY, BAR_WIDTH, BAR_HEIGHT);

        // Draw the actual bar using a hue corresponding to the user's rank
        const hue = 256 * (orderedUserIds.length - i) / orderedUserIds.length;
        context.fillStyle = `hsl(${hue},50%,50%)`;
        context.fillRect(MARGIN + BAR_PADDING,
            baseY + BAR_PADDING,
            actualBarWidth,
            BAR_HEIGHT - (BAR_PADDING * 2));

        const textHeight = BAR_HEIGHT - 4 * BAR_PADDING;
        const textWidth = context.measureText(displayName).width;

        // If the text for this user no longer fits in the bar, place the text after the bar for all remaining entries
        if (textInsideBar) {
            textInsideBar = textWidth * 1.1 < actualBarWidth;
        }

        // Write the user's display name (with a "shadow")
        const textX = MARGIN + BAR_PADDING * 2 + (textInsideBar ? 0 : Math.max(actualBarWidth, 0));
        context.font = `${textHeight}px sans-serif`;
        context.fillStyle = `rgba(0,0,0,.4)`;
        context.fillText(displayName, textX, baseY + 0.7 * BAR_HEIGHT);
        context.fillStyle = textInsideBar ? 'white' : 'BLACKISH';
        context.fillText(displayName, textX + 1, baseY + 0.7 * BAR_HEIGHT + 1);

        // Draw medals for this user
        if (medals && medals[userId]) {
            const numMedals = Object.values(medals[userId]).reduce((x, y) => x + y);

            const imageWidth = BAR_HEIGHT - 2 * BAR_PADDING - 2;
            const IMAGE_WIDTH = imageWidth + BAR_PADDING;
            let j = 0;
            const baseMedalX = WIDTH - MARGIN - BAR_PADDING - (numMedals * IMAGE_WIDTH);
            for (let k = 0; k < medals[userId].gold ?? 0; k++) {
                context.drawImage(rank1Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                j++;
            }
            for (let k = 0; k < medals[userId].silver ?? 0; k++) {
                context.drawImage(rank2Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                j++;
            }
            for (let k = 0; k < medals[userId].bronze ?? 0; k++) {
                context.drawImage(rank3Image, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                j++;
            }
            for (let k = 0; k < medals[userId].skull ?? 0; k++) {
                context.drawImage(rankLastImage, baseMedalX + j * IMAGE_WIDTH, baseY + BAR_PADDING, imageWidth, imageWidth);
                j++;
            }
        }
    }

    return c.toBuffer();
}