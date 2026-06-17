import random
from .CastleCustomFloat import CustomFloat
from .CastleEncoding import bool_array_to_binary

def encode_value(value):
    n  = max(value, 0)
    if n <= 15:
        encoded_byte = 64 | CustomFloat(2, 4).e(n + 1)
    else:
        encoded_byte = 128 | CustomFloat(4, 3).e(n - 14)
    return encoded_byte

def get_float_values():
    random.seed()
    float_list = [
        random.uniform(40, 50),   # DataPoint_Mouse_AngleVector_500 (0)
        -1,                       # DataPoint_Touch_AngleVector (1)
        random.uniform(70, 80),   # DataPoint_Key_KeysSameTimeDiff_1000 (2)
        -1,                       # DataPoint_Key_TimeDiff_SpecialKey_Up (3)
        random.uniform(60, 70),   # DataPoint_Mouse_TimeDiff_MouseDownUp (4)
        -1, 0, 0,
        random.uniform(60, 80), random.uniform(5, 10),
        random.uniform(30, 40), random.uniform(2, 5),
        -1, -1, -1, -1, -1, -1, -1, -1,
        random.uniform(150, 180), random.uniform(3, 6),
        random.uniform(150, 180), random.uniform(3, 6),
        random.uniform(0, 2), random.uniform(0, 2), 0, 0,
        -1, -1, -1, -1,
        0, 0, 0, 0, 0, 0,
        1.0, 0, 1.0, 0,
        random.uniform(0, 4), random.uniform(0, 3),
        random.uniform(25, 50), random.uniform(25, 50),
        random.uniform(25, 50), random.uniform(25, 30),
        random.uniform(0, 2), random.uniform(0, 1),
        random.uniform(0, 1), 1, 0,
    ]

    out_fp = bytes()
    for value in float_list:
        if value != -1:
            encoded_value = encode_value(value)
            out_fp += bytes([encoded_value])
        else:
            out_fp += bytes([0])
    return out_fp

def get_event_ints() -> bytes:
    int_values = [
        random.randrange(100,200),  # EVENT_MOUSEMOVE 0
        random.randrange(1, 5),     # EVENT_KEYUP 1
        random.randrange(1, 5),     # EVENT_CLICK 2
        0,                          # EVENT_TOUCHSTART 3
        random.randrange(0, 5),     # EVENT_KEYDOWN 4
        0,                          # EVENT_TOUCHMOVE 5
        0,                          # EVENT_MOUSEDOWN - EVENT_MOUSEUP 6
        0,                          # DataPoint_mouse_VectorDiff_Rounded 7
        random.randrange(0, 5),     # WheelDataPointCounter 8
        random.randrange(0, 11),    # unk1
        random.randrange(0, 1),     # unk2
    ]
    return bytes(int_values) + len(int_values).to_bytes()

def get_bitfield() -> bytes:
    # bit 1 = IsTouchDevice ; bit 2 = EVENT_CLICK>0 ; bit 3 = KeyDownCount>0
    # bit 5 = BackspaceCount ; bit 6 = NotTouchCount ; others unk
    bit_array = [False] * 15
    bit_array[2] = True
    bit_array[3] = True
    bit_array[5] = True
    bit_array[6] = True
    bit_array[9] = True
    bit_array[11] = True
    bit_array[12] = True
    binary_num = bool_array_to_binary(bit_array, 16)
    encoded_num = (6 << 20) | (2 << 16) | (65535 & binary_num)
    return encoded_num.to_bytes(3)

def get_fp_event_values():
    return get_bitfield() + get_float_values() + get_event_ints()
