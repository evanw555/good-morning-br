import canvas from "canvas";
import { Snowflake, User, UserManager } from "discord.js";

class ImageLoader {
    private readonly imageCache: Record<string, canvas.Image>;
    private users?: UserManager;
    private static readonly BROKEN_IMAGE_PATH: string = 'assets/broken.jpeg';

    constructor() {
        this.imageCache = {};
    }

    setUserManager(users: UserManager) {
        this.users = users;
    }

    async loadImage(key: string, options?: { fallbacks?: string[] }): Promise<canvas.Image> {
        if (key in this.imageCache) {
            return this.imageCache[key];
        }

        try {
            const image = await canvas.loadImage(key);
            this.imageCache[key] = image;
            return image;
        } catch (err) {
            // If any fallbacks are specified, try the next one
            if (options?.fallbacks && options.fallbacks.length > 0) {
                return this.loadImage(options.fallbacks[0], { fallbacks: options.fallbacks.slice(1)})
            }
            // Else, return the generic "broken" image
            if (key !== ImageLoader.BROKEN_IMAGE_PATH) {
                return this.loadImage(ImageLoader.BROKEN_IMAGE_PATH);
            }
            throw err;
        }
    }

    async loadAvatar(userId: Snowflake, size: 16 | 32 | 64 | 128 | 256 = 32): Promise<canvas.Image> {
        if (userId.startsWith('npc')) {
            return await this.loadImage(`assets/common/avatars/${userId}.png`);
        }
        const user = await this.getUser(userId);
        if (user) {
            const avatarUrl = user.displayAvatarURL({ extension: 'png', size });
            return await this.loadImage(avatarUrl);
        }
        return await this.loadImage(ImageLoader.BROKEN_IMAGE_PATH);
    }

    private async getUser(userId: Snowflake): Promise<User | undefined> {
        if (!this.users) {
            return undefined;
        }
        if (this.users.cache.has(userId)) {
            const user = this.users.cache.get(userId);
            if (user) {
                return user;
            }
        }
        try {
            return await this.users.fetch(userId);
        } catch (err) {
            return undefined;
        }
    }
}

export default new ImageLoader();
