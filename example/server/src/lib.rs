// Tic Tac Toe server
enum EventType {
    Unknown,
    AcceptSocket,
    ReadSocket,
}

pub struct Event {
    fd: i32,
    event_type: EventType,
}

// Buffer
const BUFFER_SIZE: usize = 1024;
static mut INPUT_BUFFER: [u8; BUFFER_SIZE] = [0; BUFFER_SIZE];

static mut PLAYERS: [i32; 2] = [0; 2];
static mut BOARD: [u8; 10] = [0; 10];
static mut TURN: u8 = 0;
static mut EVENT_MAP: [Event; 3] = [
    Event {
        fd: -1,
        event_type: EventType::Unknown,
    },
    Event {
        fd: -1,
        event_type: EventType::Unknown,
    },
    Event {
        fd: -1,
        event_type: EventType::Unknown,
    },
];

static mut ASYNC_REWIND: i32 = 0;

#[link(wasm_import_module = "wasi_snapshot_preview1")]
extern "C" {
    fn fd_close(fd: i32) -> i32;
    fn fd_read(fd: i32, iovs_ptr: *const u8, iovs_len: i32, nread_ptr: *mut i32) -> i32;
    fn fd_write(fd: i32, iovs_ptr: *const u8, iovs_len: i32, nwritten_ptr: *mut i32) -> i32;
    fn poll_async(fds: *const i32, nfds: i32, rp0: *mut i32) -> i32;
    fn sock_open(addr_family: i32, sock_type: i32, fd: *mut i32) -> i32;
}

pub unsafe fn onopen(channel_id: i32) {
    let mut buffer: [u8; 1] = [0; 1];
    if PLAYERS[0] == 0 {
        PLAYERS[0] = channel_id;
        buffer[0] = 0;
    } else if PLAYERS[1] == 0 {
        PLAYERS[1] = channel_id;
        buffer[0] = 1 << 4;
    } else {
        fd_close(channel_id);
        return;
    }
    fd_write(channel_id, buffer.as_ptr(), 1, 0 as *mut i32);
}

pub unsafe fn onmessage(channel_fd: i32, buffer: &[u8]) {
    if buffer.len() != 1 {
        return; // Invalid message
    }
    let message = buffer[0];
    let player = (message >> 4) & 1;
    let action = message & 0b00001111;

    if PLAYERS[player as usize] != channel_fd {
        return; // Invalid player
    }

    if TURN != player {
        return; // Not your turn
    }

    if action < 1 || action > 9 || BOARD[action as usize] != 0 {
        return; // Invalid action
    }

    if PLAYERS[0] == 0 || PLAYERS[1] == 0 {
        return; // Game not started
    }

    BOARD[action as usize] = player + 1;
    TURN = 1 - TURN;
    let buffer: [u8; 1] = [(player << 4) | action; 1];
    for i in 0..2 {
        fd_write(PLAYERS[i], buffer.as_ptr(), 1, 0 as *mut i32);
    }
}

pub unsafe fn onclose(channel_id: i32) {
    if PLAYERS[0] == channel_id {
        PLAYERS[0] = 0;
        for i in 1..10 {
            BOARD[i] = 0;
        }
    } else if PLAYERS[1] == channel_id {
        PLAYERS[1] = 0;
        for i in 1..10 {
            BOARD[i] = 0;
        }
    }
}

#[no_mangle]
pub unsafe fn _start() {
    if ASYNC_REWIND == 0 {
        let mut sock_fd: i32 = 0;
        sock_open(2, 1, &mut sock_fd);
        EVENT_MAP[0] = Event {
            fd: sock_fd,
            event_type: EventType::AcceptSocket,
        };
        poll_async(&sock_fd, 1, &mut ASYNC_REWIND);
    } else {
        let mut event = &Event {
            fd: -1,
            event_type: EventType::Unknown,
        };
        for ev in EVENT_MAP.iter() {
            if ev.fd == ASYNC_REWIND {
                event = ev;
            }
        }
        match event.event_type {
            EventType::AcceptSocket => {
                let sock_fd = ASYNC_REWIND;
                let mut channel_fd_buf: [i32; 1] = [0; 1];
                fd_read(
                    sock_fd,
                    channel_fd_buf.as_mut_ptr() as *mut u8,
                    4,
                    0 as *mut i32,
                );
                for ev in EVENT_MAP.iter_mut() {
                    if matches!(ev.event_type, EventType::Unknown) {
                        *ev = Event {
                            fd: channel_fd_buf[0] as i32,
                            event_type: EventType::ReadSocket,
                        };
                        break;
                    }
                }
                onopen(channel_fd_buf[0] as i32);
            }
            EventType::ReadSocket => {
                let channel_fd = ASYNC_REWIND;
                let mut nread = 0;
                let ok = fd_read(
                    channel_fd,
                    INPUT_BUFFER.as_mut_ptr(),
                    BUFFER_SIZE as i32,
                    &mut nread,
                );
                match ok {
                    0 => match INPUT_BUFFER.get(0..nread as usize) {
                        Some(buffer) => {
                            onmessage(channel_fd, buffer);
                        }
                        _ => {}
                    },
                    _err => {
                        onclose(channel_fd);
                    }
                }
            }
            _ => {}
        }
        let mut fds_len = 0;
        let mut fds: [i32; 16] = [0; 16];
        for ev in EVENT_MAP.iter() {
            if !matches!(ev.event_type, EventType::Unknown) {
                fds[fds_len] = ev.fd;
                fds_len += 1;
            }
        }
        poll_async(fds.as_ptr(), fds_len as i32, &mut ASYNC_REWIND);
    }
}
