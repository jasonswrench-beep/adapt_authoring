import { ContentPermission, GeneralPermission, TemporaryFilePermission, UserDataPermission } from '@lumieducation/h5p-server';

/**
 * Authors (signed in to the course tool and allowed to edit the component) may create, edit and export content, and
 * upload files. They may not install or update H5P libraries: libraries are code, and are only installed by the
 * administrator's update routine. The "system" role is the course tool itself, importing an activity into the editor.
 */
export default class PermissionSystem {
  async checkForUserData(user) { return Boolean(user); }

  async checkForContent(user, permission) {
    if (!user) return false;
    return [ContentPermission.Create, ContentPermission.Edit, ContentPermission.View, ContentPermission.List, ContentPermission.Download, ContentPermission.Embed, ContentPermission.Delete].includes(permission);
  }

  async checkForTemporaryFile(user) { return Boolean(user); }

  async checkForGeneralAction(user, permission) {
    if (!user) return false;
    if (user.role === 'system') return [GeneralPermission.InstallRecommended, GeneralPermission.UpdateAndInstallLibraries, GeneralPermission.CreateRestricted].includes(permission);
    return false;
  }
}
void UserDataPermission; void TemporaryFilePermission;
