'use strict';
// vm-instrument.js — L3 dispatch-loop instrumentation.
//
// Given source + a located VM interpreter (from vm-locate.js), instrument ONLY the dispatch
// point so that each executed opcode reports to __T.vm(pc, opcode). Everything else is left
// byte-identical — minimal footprint, no whole-program weaving.
//
// The trick that avoids breaking the VM: we never RE-evaluate the discriminant (it often has
// side effects like `code[pc++]`). For a switch we splice the logger INTO the discriminant:
//     switch (D)  ->  switch (__T.vm(pc, D))      // __T.vm logs and returns its 2nd arg
// so D is evaluated exactly once, by the switch itself. For an if-chain we read the (plain)
// discriminant variable once at the loop-body top.

const babel = require('@babel/core');
const t = babel.types;

// does evaluating this expression a SECOND time change program state? (e.g. code[pc++])
function hasSideEffects(node) {
  let dirty = false;
  babel.traverse(t.file(t.program([t.expressionStatement(t.cloneNode(node, true))])), {
    'UpdateExpression|AssignmentExpression|CallExpression|NewExpression|YieldExpression|AwaitExpression'() { dirty = true; },
  });
  return dirty;
}

function vmCall(pcVar, opExpr) {
  const pc = pcVar ? t.identifier(pcVar) : t.numericLiteral(0);
  return t.callExpression(
    t.memberExpression(t.identifier('__T'), t.identifier('vm')),
    [pc, opExpr]
  );
}

function srcOf(node) {
  try { return babel.transformFromAstSync(t.file(t.program([t.expressionStatement(t.cloneNode(node, true))])), null, { code: true, configFile: false, babelrc: false }).code.replace(/;\s*$/, ''); }
  catch (e) { return '<expr>'; }
}
const fnId = (path) => {
  const nm = (path.node.id && path.node.id.name) || (t.isVariableDeclarator(path.parent) && path.parent.id && path.parent.id.name) || '<anon>';
  return nm + '@' + (path.node.loc ? path.node.loc.start.line : 0);
};

// Instrument ALL located dispatchers (a function may hold several independent state machines).
function instrument(src, candOrList) {
  const cands = (Array.isArray(candOrList) ? candOrList : [candOrList]).filter(Boolean);
  const ast = babel.parse(src, { configFile: false, babelrc: false, parserOpts: { errorRecovery: true, allowReturnOutsideFunction: true } });

  // index switch candidates by fn@line | discriminant-src | cases
  const switchByKey = new Map();
  for (const c of cands) if (c.kind === 'switch') switchByKey.set(c.fnName + '@' + c.line + '|' + c.opCodeSrc + '|' + c.cases, c);
  let count = 0;

  babel.traverse(ast, {
    SwitchStatement(p) {
      if (p.node.discriminant.__jtvm) return;
      const fn = p.getFunctionParent(); if (!fn) return;
      const c = switchByKey.get(fnId(fn) + '|' + srcOf(p.node.discriminant) + '|' + p.node.cases.length);
      if (!c) return;
      const wrapped = vmCall(c.pcVar, p.node.discriminant);   // switch(D) -> switch(__T.vm(pc, D)), D evaluated once
      wrapped.__jtvm = true;
      p.node.discriminant = wrapped;
      count++;
    },
  });

  // if-chain dispatchers (rare): inject a probe at the dispatch loop top, per candidate
  for (const c of cands) {
    if (c.kind !== 'ifchain' || hasSideEffects(c.opNode)) continue;
    let done = false;
    babel.traverse(ast, {
      Function(path) {
        if (done || fnId(path) !== c.fnName + '@' + c.line) return;
        path.traverse({
          Function(p) { p.skip(); },
          'WhileStatement|ForStatement|DoWhileStatement'(p) {
            if (done) return;
            const bodySrc = babel.transformFromAstSync(t.file(t.program(t.isBlockStatement(p.node.body) ? p.node.body.body.map(s => t.cloneNode(s, true)) : [t.cloneNode(p.node.body, true)])), null, { code: true, configFile: false, babelrc: false }).code;
            if (c.opCodeSrc && bodySrc.indexOf(c.opCodeSrc) === -1) return;
            const probe = t.expressionStatement(vmCall(c.pcVar, t.cloneNode(c.opNode, true)));
            if (t.isBlockStatement(p.node.body)) p.node.body.body.unshift(probe);
            else p.node.body = t.blockStatement([probe, p.node.body]);
            done = true; count++;
          },
        });
        if (done) path.stop();
      },
    });
  }

  const out = babel.transformFromAstSync(ast, null, { code: true, configFile: false, babelrc: false, compact: false });
  return { code: out.code, instrumented: count > 0, count };
}

module.exports = { instrument };
