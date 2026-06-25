import { clearAllCaches } from "@/modules/workspace/domain/git-storage/git-store";
import { onDataDirReset, setupGlobalTestDataDirIsolation } from "./data-dir";

setupGlobalTestDataDirIsolation();
onDataDirReset(() => {
  clearAllCaches();
});
