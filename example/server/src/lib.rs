// Tic Tac Toe server

// Buffer
const BUFFER_SIZE: usize = 1024;
static mut INPUT_BUFFER: [u8; BUFFER_SIZE] = [0; BUFFER_SIZE];
static mut BUFFER: [u8; BUFFER_SIZE] = [0; BUFFER_SIZE];

static mut PLAYERS: [i32; 2] = [0; 2];
static mut BOARD: [u8; 10] = [0; 10];
static mut TURN: u8 = 0;

extern "C" {
    fn recv(channel_id: i32, buffer: *mut u8, length: i32) -> i32;
    fn send(channel_id: i32, buffer: *const u8, length: i32) -> i32;
    fn close(channel_id: i32) -> i32;
}

#[no_mangle]
pub unsafe fn onopen(channel_id: i32) {
    if PLAYERS[0] == 0 {
        PLAYERS[0] = channel_id;
        BUFFER[0] = 0;
    } else if PLAYERS[1] == 0 {
        PLAYERS[1] = channel_id;
        BUFFER[0] = 1 << 4;
    } else {
        close(channel_id);
        return;
    }
    send(channel_id, BUFFER.as_ptr(), 1);
}

#[no_mangle]
pub unsafe fn onmessage(channel_id: i32, length: i32) {
    recv(channel_id, INPUT_BUFFER.as_mut_ptr(), BUFFER_SIZE as i32);
    let message = INPUT_BUFFER[0];

    if length != 1 {
        return; // Invalid message
    }
    let player = (message >> 4) & 1;
    let action = message & 0b00001111;

    if PLAYERS[player as usize] != channel_id {
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
    BUFFER[0] = (player << 4) | action;
    for i in 0..2 {
        send(PLAYERS[i], BUFFER.as_ptr(), 1);
    }
}

#[no_mangle]
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
