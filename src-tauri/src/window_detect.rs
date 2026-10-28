//! Detect a visible top-level window owned by the launched Java process.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Probe {
    Visible,
    Pending,
    Unavailable,
}

#[cfg(target_os = "windows")]
pub fn probe(pid: u32) -> Probe {
    use windows_sys::core::BOOL;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, RECT},
        UI::WindowsAndMessaging::{
            EnumWindows, GetClientRect, GetWindow, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible, GW_OWNER,
        },
    };
    struct Search {
        pid: u32,
        found: bool,
    }
    unsafe extern "system" fn callback(hwnd: HWND, parameter: LPARAM) -> BOOL {
        let search = &mut *(parameter as *mut Search);
        let mut owner = 0u32;
        GetWindowThreadProcessId(hwnd, &mut owner);
        if owner != search.pid
            || IsWindowVisible(hwnd) == 0
            || IsIconic(hwnd) != 0
            || !GetWindow(hwnd, GW_OWNER).is_null()
        {
            return 1;
        }
        let mut rect = RECT::default();
        if GetClientRect(hwnd, &mut rect) != 0
            && rect.right - rect.left >= 200
            && rect.bottom - rect.top >= 120
        {
            search.found = true;
            return 0;
        }
        1
    }
    let mut search = Search { pid, found: false };
    let enumerated = unsafe { EnumWindows(Some(callback), &mut search as *mut Search as LPARAM) };
    if search.found {
        Probe::Visible
    } else if enumerated == 0 {
        Probe::Unavailable
    } else {
        Probe::Pending
    }
}

#[cfg(target_os = "linux")]
pub fn probe(pid: u32) -> Probe {
    use x11rb::{
        connection::Connection,
        protocol::xproto::{AtomEnum, ConnectionExt, MapState},
    };
    let Ok((connection, screen)) = x11rb::connect(None) else {
        return Probe::Unavailable;
    };
    let Some(root) = connection.setup().roots.get(screen).map(|s| s.root) else {
        return Probe::Unavailable;
    };
    let get_atom = |name: &[u8]| {
        connection
            .intern_atom(false, name)
            .ok()?
            .reply()
            .ok()
            .map(|r| r.atom)
    };
    let (Some(clients), Some(pid_atom)) = (get_atom(b"_NET_CLIENT_LIST"), get_atom(b"_NET_WM_PID"))
    else {
        return Probe::Unavailable;
    };
    let windows = connection
        .get_property(false, root, clients, AtomEnum::WINDOW, 0, 65_535)
        .ok()
        .and_then(|r| r.reply().ok())
        .and_then(|r| r.value32().map(|v| v.collect::<Vec<_>>()))
        .unwrap_or_default();
    let windows = if windows.is_empty() {
        connection
            .query_tree(root)
            .ok()
            .and_then(|r| r.reply().ok())
            .map(|r| r.children)
            .unwrap_or_default()
    } else {
        windows
    };
    for window in windows {
        let window_pid = connection
            .get_property(false, window, pid_atom, AtomEnum::CARDINAL, 0, 1)
            .ok()
            .and_then(|r| r.reply().ok())
            .and_then(|r| r.value32().and_then(|mut v| v.next()));
        if window_pid != Some(pid) {
            continue;
        }
        let visible = connection
            .get_window_attributes(window)
            .ok()
            .and_then(|r| r.reply().ok())
            .is_some_and(|r| r.map_state == MapState::VIEWABLE);
        let large = connection
            .get_geometry(window)
            .ok()
            .and_then(|r| r.reply().ok())
            .is_some_and(|r| r.width >= 200 && r.height >= 120);
        if visible && large {
            return Probe::Visible;
        }
    }
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        Probe::Unavailable
    } else {
        Probe::Pending
    }
}

#[cfg(target_os = "macos")]
pub fn probe(pid: u32) -> Probe {
    use std::ffi::c_void;
    type CFRef = *const c_void;
    #[repr(C)]
    struct Point {
        x: f64,
        y: f64,
    }
    #[repr(C)]
    struct Size {
        width: f64,
        height: f64,
    }
    #[repr(C)]
    struct Rect {
        origin: Point,
        size: Size,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(options: u32, window: u32) -> CFRef;
        fn CGRectMakeWithDictionaryRepresentation(dictionary: CFRef, rect: *mut Rect) -> bool;
        static kCGWindowOwnerPID: CFRef;
        static kCGWindowLayer: CFRef;
        static kCGWindowBounds: CFRef;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFArrayGetCount(array: CFRef) -> isize;
        fn CFArrayGetValueAtIndex(array: CFRef, index: isize) -> CFRef;
        fn CFDictionaryGetValue(dictionary: CFRef, key: CFRef) -> CFRef;
        fn CFNumberGetValue(number: CFRef, kind: i32, value: *mut c_void) -> bool;
        fn CFRelease(value: CFRef);
    }
    unsafe {
        let windows = CGWindowListCopyWindowInfo(1 | 16, 0);
        if windows.is_null() {
            return Probe::Unavailable;
        }
        let mut found = false;
        for i in 0..CFArrayGetCount(windows) {
            let window = CFArrayGetValueAtIndex(windows, i);
            let owner = CFDictionaryGetValue(window, kCGWindowOwnerPID);
            let layer = CFDictionaryGetValue(window, kCGWindowLayer);
            let bounds = CFDictionaryGetValue(window, kCGWindowBounds);
            if owner.is_null() || layer.is_null() || bounds.is_null() {
                continue;
            }
            let mut owner_pid = 0i32;
            let mut window_layer = 0i32;
            if !CFNumberGetValue(owner, 3, &mut owner_pid as *mut _ as *mut c_void)
                || !CFNumberGetValue(layer, 3, &mut window_layer as *mut _ as *mut c_void)
                || owner_pid != pid as i32
                || window_layer != 0
            {
                continue;
            }
            let mut rect = Rect {
                origin: Point { x: 0.0, y: 0.0 },
                size: Size {
                    width: 0.0,
                    height: 0.0,
                },
            };
            if CGRectMakeWithDictionaryRepresentation(bounds, &mut rect)
                && rect.size.width >= 200.0
                && rect.size.height >= 120.0
            {
                found = true;
                break;
            }
        }
        CFRelease(windows);
        if found {
            Probe::Visible
        } else {
            Probe::Pending
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
pub fn probe(_: u32) -> Probe {
    Probe::Unavailable
}

#[derive(Default)]
pub struct Monitor {
    warned_unavailable: bool,
    warned_slow: bool,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Notice {
    Visible,
    Unavailable,
    Slow,
}
impl Monitor {
    pub fn observe(&mut self, probe: Probe, elapsed: std::time::Duration) -> Option<Notice> {
        match probe {
            Probe::Visible => Some(Notice::Visible),
            Probe::Unavailable if !self.warned_unavailable => {
                self.warned_unavailable = true;
                Some(Notice::Unavailable)
            }
            _ if elapsed >= std::time::Duration::from_secs(60) && !self.warned_slow => {
                self.warned_slow = true;
                Some(Notice::Slow)
            }
            _ => None,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn waits_for_visible_window_even_after_delays_and_unavailable_probes() {
        let mut m = Monitor::default();
        assert_eq!(
            m.observe(Probe::Pending, std::time::Duration::from_secs(2)),
            None
        );
        assert_eq!(
            m.observe(Probe::Unavailable, std::time::Duration::from_secs(3)),
            Some(Notice::Unavailable)
        );
        assert_eq!(
            m.observe(Probe::Unavailable, std::time::Duration::from_secs(4)),
            None
        );
        assert_eq!(
            m.observe(Probe::Pending, std::time::Duration::from_secs(61)),
            Some(Notice::Slow)
        );
        assert_eq!(
            m.observe(Probe::Pending, std::time::Duration::from_secs(62)),
            None
        );
        assert_eq!(
            m.observe(Probe::Visible, std::time::Duration::from_secs(63)),
            Some(Notice::Visible)
        );
    }
}
