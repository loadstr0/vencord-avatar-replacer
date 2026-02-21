/*
 * Vencord Userplugin: AvatarReplacer
 * Copyright (c) 2026 loadstr0
 */

import { definePluginSettings } from "@api/Settings";
import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, Toasts, UserStore } from "@webpack/common";
import type { User } from "@vencord/discord-types";

type OverrideEntry = {
    avatarHash: string | null;
    dataUrl: string;
};

type OverridesMap = Record<string, OverrideEntry>;

const settings = definePluginSettings({
    overridesJson: {
        type: OptionType.STRING,
        description: "Internal storage (JSON).",
        default: "{}"
    },
    maxSizePx: {
        type: OptionType.NUMBER,
        description: "Max width/height for stored replacement image (smaller = safer).",
        default: 256
    },
    jpegQuality: {
        type: OptionType.NUMBER,
        description: "JPEG quality (0.1 - 1).",
        default: 0.85
    }
});

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function safeParseOverrides(raw: string): OverridesMap {
    try {
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return {};
        const out: OverridesMap = {};
        for (const [userId, entry] of Object.entries(obj)) {
            if (typeof userId !== "string" || !userId) continue;
            if (!entry || typeof entry !== "object") continue;

            const avatarHash = (entry as any).avatarHash;
            const dataUrl = (entry as any).dataUrl;

            if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) continue;
            out[userId] = {
                avatarHash: typeof avatarHash === "string" || avatarHash === null ? avatarHash : null,
                dataUrl
            };
        }
        return out;
    } catch {
        return {};
    }
}

function parseAvatarCdn(src: string): { userId: string; hash: string } | null {
    const m = src.match(
        /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/avatars\/(\d+)\/([^/?#.]+)\./
    );
    if (!m) return null;
    return { userId: m[1], hash: m[2] };
}

async function fileToCompressedDataUrl(
    file: File,
    maxSizePx: number,
    quality: number
): Promise<string> {
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
        throw new Error("That file is too large. Pick a smaller image (<= 5MB).");
    }

    const blobUrl = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.decoding = "async";
        img.src = blobUrl;

        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Failed to load image."));
        });

        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        const max = Math.max(w, h);
        const scale = max > maxSizePx ? maxSizePx / max : 1;

        const tw = Math.max(1, Math.round(w * scale));
        const th = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement("canvas");
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported.");

        ctx.drawImage(img, 0, 0, tw, th);

        const q = clamp(quality, 0.1, 1);
        return canvas.toDataURL("image/jpeg", q);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

function pickImageFile(): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.display = "none";

        input.onchange = () => {
            const f = input.files?.[0] ?? null;
            input.remove();
            resolve(f);
        };

        document.body.appendChild(input);
        input.click();
    });
}

export default definePlugin({
    name: "AvatarReplacer",
    description:
        "Clientside avatar overrides per-user. Right click -> Change profile picture. Auto-resets when the user changes their real avatar.",
    authors: [{ id: 1117568708399861790, name: "loadstr" }],
    settings,

    contextMenus: {
        "user-context": (children, props) => {
            const user = (props as any)?.user as User | undefined;
            if (!user) return;
            children.push(makeMenuItemsForUser(user));
        },

        "user-profile-actions": (children, props) => {
            const user = (props as any)?.user as User | undefined;
            if (!user) return;
            children.push(makeMenuItemsForUser(user));
        },

        "user-profile-overflow-menu": (children, props) => {
            const user = (props as any)?.user as User | undefined;
            if (!user) return;
            children.push(makeMenuItemsForUser(user));
        }
    } satisfies Record<string, NavContextMenuPatchCallback>,

    start() {
        let overrides: OverridesMap = safeParseOverrides(settings.store.overridesJson);

        const syncFromStore = () => {
            overrides = safeParseOverrides(settings.store.overridesJson);
        };

        const writeToStore = (next: OverridesMap) => {
            overrides = next;
            settings.store.overridesJson = JSON.stringify(next);
        };

        (this as any)._arGetOverrides = () => overrides;
        (this as any)._arSyncFromStore = syncFromStore;
        (this as any)._arWriteToStore = writeToStore;

        const originals = new WeakMap<HTMLImageElement, { src: string; srcset: string | null }>();

        const restore = (img: HTMLImageElement) => {
            const orig = originals.get(img);
            if (!orig) return;
            img.src = orig.src;
            if (orig.srcset) img.setAttribute("srcset", orig.srcset);
            else img.removeAttribute("srcset");
            originals.delete(img);
        };

        let scheduled = false;
        const queueScan = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                scanAndApply();
            });
        };

        const applyToImg = (img: HTMLImageElement) => {
            const srcAttr = img.getAttribute("src") ?? "";
            if (!srcAttr) return;

            if (!srcAttr.includes("/avatars/")) {
                restore(img);
                return;
            }

            const parsed = parseAvatarCdn(srcAttr);
            if (!parsed) {
                restore(img);
                return;
            }

            const entry = overrides[parsed.userId];
            if (!entry) {
                restore(img);
                return;
            }

            if (entry.avatarHash && entry.avatarHash !== parsed.hash) {
                const next = { ...overrides };
                delete next[parsed.userId];
                writeToStore(next);
                restore(img);
                return;
            }

            if (!originals.has(img)) {
                originals.set(img, { src: img.src, srcset: img.getAttribute("srcset") });
            }

            if (img.src !== entry.dataUrl) {
                img.src = entry.dataUrl;
                img.removeAttribute("srcset");
            }
        };

        const scanAndApply = () => {
            document.querySelectorAll("img[src*='/avatars/']").forEach(n => {
                if (n instanceof HTMLImageElement) applyToImg(n);
            });
        };

        queueScan();

        const obs = new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type === "childList") {
                    // New stuff added -> scan soon
                    if (m.addedNodes.length) queueScan();
                } else if (m.type === "attributes") {
                    // Avatar src changed -> scan soon
                    if (m.attributeName === "src" || m.attributeName === "srcset") queueScan();
                }
            }
        });

        obs.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["src", "srcset"]
        });

        (this as any)._stop = () => {
            obs.disconnect();
            document.querySelectorAll("img").forEach(n => {
                if (n instanceof HTMLImageElement) restore(n);
            });
        };
    },

    stop() {
        (this as any)._stop?.();
        delete (this as any)._arGetOverrides;
        delete (this as any)._arSyncFromStore;
        delete (this as any)._arWriteToStore;
    }
});

function makeMenuItemsForUser(user: User) {
    const pluginAny = (globalThis as any).Vencord?.Plugins?.plugins?.AvatarReplacer;
    const getOverrides: (() => OverridesMap) | undefined = pluginAny?._arGetOverrides;
    const writeToStore: ((m: OverridesMap) => void) | undefined = pluginAny?._arWriteToStore;

    const currentUser = UserStore.getCurrentUser?.();
    const isSelf = currentUser && user.id === currentUser.id;

    if (!getOverrides || !writeToStore) return null;

    const overrides = getOverrides();
    const hasOverride = !!overrides[user.id];

    return (
        <>
            <Menu.MenuItem
                id="vc-avatar-replacer-change"
                label="Change profile picture"
                disabled={!!isSelf}
                action={() => {
                    setTimeout(async () => {
                        try {
                            const file = await pickImageFile();
                            if (!file) return;

                            const maxSize = (settings.store as any).maxSizePx ?? 256;
                            const q = (settings.store as any).jpegQuality ?? 0.85;

                            const dataUrl = await fileToCompressedDataUrl(file, maxSize, q);

                            const avatarHash = (user as any).avatar ?? null;

                            const next = { ...getOverrides() };
                            next[user.id] = { avatarHash, dataUrl };
                            writeToStore(next);

                            Toasts.show({
                                message: "Avatar override saved (clientside).",
                                type: Toasts.Type.SUCCESS
                            });
                        } catch (e: any) {
                            Toasts.show({
                                message: String(e?.message ?? e ?? "Failed to set avatar."),
                                type: Toasts.Type.FAILURE
                            });
                        }
                    }, 0);
                }}
            />
            {hasOverride && (
                <Menu.MenuItem
                    id="vc-avatar-replacer-reset"
                    label="Reset profile picture override"
                    color="danger"
                    action={() => {
                        const next = { ...getOverrides() };
                        delete next[user.id];
                        writeToStore(next);

                        Toasts.show({
                            message: "Avatar override removed.",
                            type: Toasts.Type.SUCCESS
                        });
                    }}
                />
            )}
        </>
    );

}
