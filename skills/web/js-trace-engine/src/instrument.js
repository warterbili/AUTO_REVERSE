'use strict';
// instrument.js — L1 AST probe engine (Babel).
//
// Weaves trace callbacks into JS source so that, when the code later runs in the
// Node harness, every instrumented operation reports to the global `__T` sink:
//   - function enter/exit          -> __T.enter(id, name, line) / __T.exit(id)
//   - identifier assignments       -> __T.set(name, value, line)   (returns value)
//   - variable declarators         -> same, on the init expression
//   - member READS  (opt-in)       -> __T.get(objExpr, prop, value, line)  (returns value)
//   - `debugger` statements        -> stripped (cheap anti-anti-debug)
//
// It is also the RECURSION primitive: prelude.js's eval/Function hooks call
// instrumentCode() on every runtime-generated string before executing it, so code
// that only exists after decryption gets probed too.
//
// Deliberately conservative: only Identifier LHS assignments and block-body
// functions are touched, to avoid changing semantics of weird obfuscated code.
// Member reads are off by default (trace explosion); enable with opts.members.

const { transformSync } = require('@babel/core');

function makePlugin(opts) {
  return function ({ types: t }) {
    let fnCounter = 0;
    const idStack = []; // enclosing function ids, for return-value capture

    const callT = (method, args) =>
      t.callExpression(
        t.memberExpression(t.identifier('__T'), t.identifier(method)),
        args
      );
    const line = (node) => t.numericLiteral(node.loc ? node.loc.start.line : 0);

    return {
      name: 'js-trace-instrument',
      visitor: {
        DebuggerStatement(path) {
          path.remove();
        },

        ReturnStatement(path) {
          const n = path.node;
          if (n.__jt || !n.argument || idStack.length === 0) return;
          n.__jt = true;
          n.argument = callT('ret', [t.numericLiteral(idStack[idStack.length - 1]), n.argument]);
        },

        Function: {
          exit(path) {
            if (path.node.__jtPushed) idStack.pop();
          },
          enter(path) {
          const body = path.node.body;
          if (!body || body.type !== 'BlockStatement') return; // skip arrow-expr bodies
          if (path.node.__jt) return;
          path.node.__jt = true;

          const id = ++fnCounter;
          idStack.push(id);
          path.node.__jtPushed = true;
          let name = '<anon>';
          if (path.node.id && path.node.id.name) name = path.node.id.name;
          else if (path.parent && t.isVariableDeclarator(path.parent) && path.parent.id.name)
            name = path.parent.id.name;
          else if (path.parent && t.isObjectProperty(path.parent) && path.parent.key && path.parent.key.name)
            name = path.parent.key.name;

          const enter = t.expressionStatement(
            callT('enter', [t.numericLiteral(id), t.stringLiteral(name), line(path.node)])
          );
          const exit = t.expressionStatement(callT('exit', [t.numericLiteral(id)]));
          // try { <orig> } finally { __T.exit }  — fires on return AND throw.
          const wrapped = t.tryStatement(
            t.blockStatement(body.body),
            null,
            t.blockStatement([exit])
          );
          body.body = [enter, wrapped];
          },
        },

        AssignmentExpression(path) {
          const n = path.node;
          if (n.operator !== '=' || n.__jt) return;
          if (!t.isIdentifier(n.left)) return;
          n.__jt = true;
          n.right = callT('set', [t.stringLiteral(n.left.name), n.right, line(n)]);
        },

        VariableDeclarator(path) {
          const n = path.node;
          if (!n.init || n.__jt) return;
          if (!t.isIdentifier(n.id)) return;
          n.__jt = true;
          n.init = callT('set', [t.stringLiteral(n.id.name), n.init, line(n)]);
        },

        MemberExpression(path) {
          if (!opts.members) return;
          const n = path.node;
          if (n.__jt) return;
          // only READS: skip LHS of assignment and update/delete targets and call callees
          if (path.parentPath.isAssignmentExpression({ left: n })) return;
          if (path.parentPath.isUpdateExpression()) return;
          if (path.parentPath.isCallExpression({ callee: n })) return; // keep `this`
          if (path.parentPath.isUnaryExpression({ operator: 'delete' })) return;
          if (n.computed && !t.isStringLiteral(n.property) && !t.isNumericLiteral(n.property)) {
            // dynamic key — skip (would double-eval the key expression)
            return;
          }
          n.__jt = true;
          const propName = n.computed
            ? String(n.property.value)
            : n.property.name;
          path.replaceWith(
            callT('get', [t.stringLiteral(propName), n, line(n)])
          );
          path.node.__jt = true;
          path.skip();
        },
      },
    };
  };
}

function instrumentCode(src, opts = {}) {
  const res = transformSync(src, {
    babelrc: false,
    configFile: false,
    compact: false,
    code: true,
    sourceMaps: false,
    sourceType: opts.dynamic ? 'script' : 'unambiguous',
    plugins: [makePlugin(opts)],
    parserOpts: {
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
    },
  });
  return { code: res.code };
}

module.exports = { instrumentCode };
