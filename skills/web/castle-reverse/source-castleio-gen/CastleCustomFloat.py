import math

def is_var_numerical(n):
    return isinstance(n, (int, float))

MAX_UINT16 = 65535

class CustomFloat:
    """Custom floating-point encoding with N exponent bits and M mantissa bits."""
    def __init__(self, exp_bits, man_bits):
        self.exp = exp_bits
        self.man = man_bits
        self.a = (1 << exp_bits) - 1
        self.b = (1 << man_bits) - 1

    def e(self, n):
        def decompose(n):
            base = 2
            sign = 0
            exponent = 0
            if n == 0:
                return {'s': 0, 'm': 0, 'e': 0}
            if n < 0:
                sign = 1
                n = -n
            while base <= n:
                n /= base
                exponent += 1
            while n < 1:
                n *= base
                exponent -= 1
            return {'s': sign, 'm': n, 'e': exponent}

        components = decompose(n)
        exponent = components['e']
        exponent = min(exponent, (1 << self.exp) - 1)
        mantissa = components['m']

        def get_mantissa_bits(mantissa, man_bits):
            fractional_part = mantissa - math.floor(mantissa)
            mantissa_bits = 0
            if fractional_part > 0:
                position = 1
                temp = fractional_part
                while temp != 0 and position <= man_bits:
                    temp *= 2
                    bit = math.floor(temp)
                    mantissa_bits |= int(bit) << (man_bits - position)
                    temp -= bit
                    position += 1
            return mantissa_bits

        mantissa_bits = get_mantissa_bits(mantissa, self.man)
        encoded_value = (exponent << self.man) | mantissa_bits
        return encoded_value

    def d(self, n):
        exponent = (n >> self.man) & self.a
        mantissa_bits = n & self.b
        value = (mantissa_bits / (2 ** self.man) + 1) * (2 ** exponent)
        return value
