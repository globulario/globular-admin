
export * from "./core";
export * from "./services";

export * as apps from "./apps";
export * as ui from "./ui";

// Backward-compat: surface common UI notifiers directly (was previously exported at root)
export { displayMessage, displayError, displaySuccess, displayQuestion } from "./ui/notify";

// Backward-compat: commonly used media helpers that used to be at root
// (To avoid repeated missing-export errors in existing apps, expose the whole media/title surface.)
export * from "./media/title";
export * from "./media/media";
export * from "./media/blog";

export { Backend } from "./backend";
export { getEventClient } from "./event/event";
export * from "./repository";
