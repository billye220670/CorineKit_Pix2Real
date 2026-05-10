param(
    [string]$Title = 'Select Folder',
    [string]$InitialPath = ''
)

# Keep this script pure ASCII. PowerShell 5.1 on Chinese Windows treats
# UTF-8 .ps1 files without BOM as GBK, which corrupts non-ASCII literals
# and breaks parsing. Any localized text (titles, etc.) must be passed in
# via parameters from Node so the process argv layer (UTF-16) carries it.

# Ensure stdout is UTF-8 so Node can decode paths containing CJK chars.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class VistaFolderPicker {

    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7"), ClassInterface(ClassInterfaceType.None)]
    class FileOpenDialogRCW { }

    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IFileOpenDialog {
        [PreserveSig] uint Show([In, Optional] IntPtr hwndOwner);
        [PreserveSig] uint SetFileTypes();
        [PreserveSig] uint SetFileTypeIndex([In] uint iFileType);
        [PreserveSig] uint GetFileTypeIndex(out uint piFileType);
        [PreserveSig] uint Advise();
        [PreserveSig] uint Unadvise();
        [PreserveSig] uint SetOptions([In] uint fos);
        [PreserveSig] uint GetOptions(out uint pfos);
        [PreserveSig] uint SetDefaultFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
        [PreserveSig] uint SetFolder([MarshalAs(UnmanagedType.Interface)] IShellItem psi);
        [PreserveSig] uint GetFolder([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
        [PreserveSig] uint GetCurrentSelection([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
        [PreserveSig] uint SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        [PreserveSig] uint GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        [PreserveSig] uint SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        [PreserveSig] uint SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        [PreserveSig] uint SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        [PreserveSig] uint GetResult([MarshalAs(UnmanagedType.Interface)] out IShellItem ppsi);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItem {
        [PreserveSig] uint BindToHandler();
        [PreserveSig] uint GetParent();
        [PreserveSig] uint GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        [PreserveSig] uint GetAttributes();
        [PreserveSig] uint Compare();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        [In] ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    // DPI awareness APIs. Without these the host (powershell.exe) is DPI-unaware,
    // so Windows bitmap-stretches the dialog on HiDPI displays and it looks blurry.
    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("shcore.dll")]
    static extern int SetProcessDpiAwareness(int value);
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    const uint FOS_PICKFOLDERS = 0x20;
    const uint FOS_FORCEFILESYSTEM = 0x40;
    const uint SIGDN_FILESYSPATH = 0x80058000;
    const uint S_OK = 0x0;

    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4 (Win10 1703+)
    // PROCESS_PER_MONITOR_DPI_AWARE = 2 (Win8.1+)
    public static void EnableDpiAwareness() {
        try {
            if (SetProcessDpiAwarenessContext((IntPtr)(-4))) return;
        } catch { }
        try {
            SetProcessDpiAwareness(2);
            return;
        } catch { }
        try { SetProcessDPIAware(); } catch { }
    }

    public static string Pick(string title, string initialPath) {
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialogRCW();
        try {
            dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
            if (!string.IsNullOrEmpty(initialPath)) {
                try {
                    Guid riid = typeof(IShellItem).GUID;
                    IShellItem initItem;
                    if (SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref riid, out initItem) == 0 && initItem != null) {
                        dialog.SetFolder(initItem);
                    }
                } catch { }
            }
            uint hr = dialog.Show(IntPtr.Zero);
            if (hr != S_OK) return null;
            IShellItem item;
            if (dialog.GetResult(out item) != S_OK || item == null) return null;
            string path;
            if (item.GetDisplayName(SIGDN_FILESYSPATH, out path) != S_OK) return null;
            return path;
        } finally {
            Marshal.ReleaseComObject(dialog);
        }
    }
}
"@ | Out-Null

# Must be called before ANY UI is created in this process, otherwise Windows
# will still bitmap-stretch the Shell dialog. We call it once right before
# the folder picker is shown.
try { [VistaFolderPicker]::EnableDpiAwareness() } catch { }

$result = [VistaFolderPicker]::Pick($Title, $InitialPath)
if ($result) { Write-Output $result }
