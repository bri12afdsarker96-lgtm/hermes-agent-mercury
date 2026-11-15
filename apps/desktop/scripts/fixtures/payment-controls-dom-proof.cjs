// Appended to the staged upstream feige-payment.test.cjs to reuse its DOM fixture.
test('payment controls runner emits measured DOM contract evidence', () => {
  const evidence = { scope: 'production feige-payment.js in synthetic jsdom', chatReads: 0, cases: [] };
  for (const amount of [3.25, 7.5]) {
    for (const record of [emptyRecord, '暂无记录', emptyRecord + '，其他信息', `补差价 ${amount}元 打款成功`]) {
      const f = fixture({ record });
      try {
        const inspected = f.bind();
        const eligible = record === emptyRecord;
        assert.equal(inspected.eligible, eligible);
        if (eligible) {
          for (const invalid of [0, -1, 100000.01, String(amount)]) {
            assert.equal(f.api.fillCompensation(order, invalid).ok, false);
          }
          assert.equal(f.api.fillCompensation(order, amount).ok, true);
          const focused = f.api.focusAmount(order, amount);
          assert.equal(focused.ok, true);
          assert.equal(Number(focused.inputText), amount);
          f.nativeInput(f.model.amount, String(amount));
          const prepared = f.api.verifyPrepared(order, amount);
          assert.equal(prepared.prepared, true);
          assert.equal(prepared.amount, amount);
          assert.equal(prepared.paymentType, '补差价');
          assert.equal(f.api.submit(order, amount + 1).ok, false);
          assert.equal(f.api.submit(order, amount).submitted, true);
          assert.equal(f.api.confirmation(order, amount).needsConfirmation, true);
          assert.equal(f.api.confirm(order, amount).confirmed, true);
          f.model.record.textContent = '补差价 5元 打款成功';
          assert.notEqual(f.api.result(order).status, 'paid');
          f.model.record.textContent = `补差价 ${amount}元 打款成功`;
          assert.equal(f.api.result(order).status, 'paid');
        } else {
          assert.equal(f.api.fillCompensation(order, amount).ok, false);
        }
        assert.equal(f.model.firstSubmits, eligible ? 1 : 0);
        assert.equal(f.model.finalSubmits, eligible ? 1 : 0);
        assert.equal(f.model.chatReads, 0);
        evidence.chatReads += f.model.chatReads;
        evidence.cases.push({ amount, record, eligible, firstSubmits: f.model.firstSubmits,
          finalSubmits: f.model.finalSubmits, chatReads: f.model.chatReads });
      } finally {
        f.window.close();
      }
    }
  }
  fs.writeFileSync(process.env.PAYMENT_CONTROLS_DOM_EVIDENCE, JSON.stringify(evidence, null, 2));
});
