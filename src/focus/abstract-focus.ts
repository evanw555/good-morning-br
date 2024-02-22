import { Message, PartialMessage, Typing } from "discord.js";
import { MessengerPayload } from "../types";

export default abstract class AbstractFocusHandler {
    abstract getGoodMorningMessage(intro: string): Promise<MessengerPayload>;
    abstract onMorningMessage(message: Message): Promise<void>;
    async onMorningTyping(typing: Typing): Promise<void> {}
    async onMorningMessageUpdate(oldMessage: PartialMessage | Message, newMessage: PartialMessage | Message): Promise<void> {}
    async onPreNoon(): Promise<void> {}
    async onBaitingStart(): Promise<void> {}
    async onNoon(): Promise<void> {}
    async onTimeout(arg: any): Promise<void> {}
}