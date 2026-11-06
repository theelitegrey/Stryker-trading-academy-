// Zscript opcodes. Shared by the compiler, the VM and the program validator.
// [name, operand count]. Order is part of the program format (v1): only APPEND new ops.
export const OP_LIST = [
  ['NOP', 0], ['CONST', 1], ['NA', 0], ['TRUE', 0], ['FALSE', 0], ['POP', 0], ['DUP', 0],
  ['LOAD', 1], ['STORE', 1], ['STOREK', 1], ['INPUT', 1], ['BVAR', 1], ['HIST', 1], ['BHIST', 1],
  ['ADD', 0], ['SUB', 0], ['MUL', 0], ['DIV', 0], ['MOD', 0], ['NEG', 0], ['NOT', 0],
  ['EQ', 0], ['NE', 0], ['LT', 0], ['LE', 0], ['GT', 0], ['GE', 0],
  ['JMP', 1], ['JF', 1], ['JT', 1], ['CALL', 3], ['VARSKIP', 2], ['TUPLE', 1], ['UNPACK', 1],
  ['LOOP', 1], ['LOOPRESET', 1], ['SEC', 2], ['TOBOOL', 0], ['SADD', 0], ['SRCIN', 1],
];
export const OP = Object.freeze(Object.fromEntries(OP_LIST.map(([n], i) => [n, i])));
export const OP_ARGC = Object.freeze(OP_LIST.map(([, n]) => n));
export const PROGRAM_VERSION = 1;
