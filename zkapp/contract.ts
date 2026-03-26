import {
  Field,
  Permissions,
  PublicKey,
  SmartContract,
  State,
  Struct,
  UInt64,
  method,
  state,
  Poseidon
} from 'o1js';
import { PrivateStateTransitionProof } from './private-state-prover.js';

export class SettlementBatchCommittedEvent extends Struct({
  batchId: UInt64,
  batchHash: Field,
  newSettlementRoot: Field,
  newBookRoot: Field,
  newNoteRoot: Field,
  newNullifierRoot: Field,
  newSequencingRoot: Field
}) {}

export class ShadowBookSettlementZkApp extends SmartContract {
  @state(Field) marketConfigHash = State<Field>();
  @state(Field) settlementRoot = State<Field>();
  @state(Field) bookRoot = State<Field>();
  @state(Field) noteRoot = State<Field>();
  @state(Field) nullifierRoot = State<Field>();
  @state(Field) sequencingRoot = State<Field>();
  @state(UInt64) lastBatchId = State<UInt64>();

  events = {
    batchCommitted: SettlementBatchCommittedEvent
  };

  init() {
    super.init();
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.signature(),
      setPermissions: Permissions.signature()
    });
    this.marketConfigHash.set(Field(0));
    this.settlementRoot.set(Field(0));
    this.bookRoot.set(Field(0));
    this.noteRoot.set(Field(0));
    this.nullifierRoot.set(Field(0));
    this.sequencingRoot.set(Field(0));
    this.lastBatchId.set(UInt64.from(0));
  }

  /**
   * One-time market config for this deployment.
   */
  @method async configureMarket(marketIdHash: Field, baseTokenIdHash: Field, quoteTokenIdHash: Field, operator: PublicKey) {
    this.requireSignature();
    const configHash = Poseidon.hash([
      marketIdHash,
      baseTokenIdHash,
      quoteTokenIdHash,
      ...operator.toFields()
    ]);
    this.marketConfigHash.set(configHash);
  }

  /**
   * Commits the next settlement batch hash plus current public/private roots.
   * settlementRoot update:
   * Poseidon(oldSettlementRoot, batchHash, batchId, oldBookRoot, oldNoteRoot, oldNullifierRoot, oldSequencingRoot, newBookRoot, newNoteRoot, newNullifierRoot, newSequencingRoot)
   */
  @method async commitBatch(
    batchId: UInt64,
    batchHash: Field,
    bookRoot: Field,
    noteRoot: Field,
    nullifierRoot: Field,
    sequencingRoot: Field
  ) {
    const configuredHash = this.marketConfigHash.getAndRequireEquals();
    configuredHash.assertNotEquals(Field(0));
    this.requireSignature();

    const currentRoot = this.settlementRoot.getAndRequireEquals();
    const currentBookRoot = this.bookRoot.getAndRequireEquals();
    const currentNoteRoot = this.noteRoot.getAndRequireEquals();
    const currentNullifierRoot = this.nullifierRoot.getAndRequireEquals();
    const currentSequencingRoot = this.sequencingRoot.getAndRequireEquals();
    const currentBatch = this.lastBatchId.getAndRequireEquals();

    const expected = currentBatch.add(UInt64.from(1));
    expected.assertEquals(batchId);

    const nextRoot = Poseidon.hash([
      currentRoot,
      batchHash,
      ...batchId.toFields(),
      currentBookRoot,
      currentNoteRoot,
      currentNullifierRoot,
      currentSequencingRoot,
      bookRoot,
      noteRoot,
      nullifierRoot,
      sequencingRoot
    ]);

    this.settlementRoot.set(nextRoot);
    this.bookRoot.set(bookRoot);
    this.noteRoot.set(noteRoot);
    this.nullifierRoot.set(nullifierRoot);
    this.sequencingRoot.set(sequencingRoot);
    this.lastBatchId.set(batchId);

    this.emitEvent(
      'batchCommitted',
      new SettlementBatchCommittedEvent({
        batchId,
        batchHash,
        newSettlementRoot: nextRoot,
        newBookRoot: bookRoot,
        newNoteRoot: noteRoot,
        newNullifierRoot: nullifierRoot,
        newSequencingRoot: sequencingRoot
      })
    );
  }

  /**
   * Commits the next settlement batch, but only after verifying the private-state
   * transition proof that binds the batch hash to the next note/nullifier roots.
   * Matching remains off-chain; proof verification happens only at batch commit time.
   */
  @method async commitBatchWithProof(
    batchId: UInt64,
    batchHash: Field,
    bookRoot: Field,
    noteRoot: Field,
    nullifierRoot: Field,
    sequencingRoot: Field,
    proof: PrivateStateTransitionProof
  ) {
    const configuredHash = this.marketConfigHash.getAndRequireEquals();
    configuredHash.assertNotEquals(Field(0));
    this.requireSignature();

    const currentRoot = this.settlementRoot.getAndRequireEquals();
    const currentBookRoot = this.bookRoot.getAndRequireEquals();
    const currentNoteRoot = this.noteRoot.getAndRequireEquals();
    const currentNullifierRoot = this.nullifierRoot.getAndRequireEquals();
    const currentSequencingRoot = this.sequencingRoot.getAndRequireEquals();
    const currentBatch = this.lastBatchId.getAndRequireEquals();

    const expected = currentBatch.add(UInt64.from(1));
    expected.assertEquals(batchId);

    proof.verify();
    proof.publicInput.batchHash.assertEquals(batchHash);
    proof.publicInput.prevRoots.noteRoot.assertEquals(currentNoteRoot);
    proof.publicInput.prevRoots.nullifierRoot.assertEquals(currentNullifierRoot);
    proof.publicInput.nextRoots.noteRoot.assertEquals(noteRoot);
    proof.publicInput.nextRoots.nullifierRoot.assertEquals(nullifierRoot);
    proof.publicOutput.nextRoots.noteRoot.assertEquals(noteRoot);
    proof.publicOutput.nextRoots.nullifierRoot.assertEquals(nullifierRoot);

    const nextRoot = Poseidon.hash([
      currentRoot,
      batchHash,
      ...batchId.toFields(),
      currentBookRoot,
      currentNoteRoot,
      currentNullifierRoot,
      currentSequencingRoot,
      bookRoot,
      noteRoot,
      nullifierRoot,
      sequencingRoot
    ]);

    this.settlementRoot.set(nextRoot);
    this.bookRoot.set(bookRoot);
    this.noteRoot.set(noteRoot);
    this.nullifierRoot.set(nullifierRoot);
    this.sequencingRoot.set(sequencingRoot);
    this.lastBatchId.set(batchId);

    this.emitEvent(
      'batchCommitted',
      new SettlementBatchCommittedEvent({
        batchId,
        batchHash,
        newSettlementRoot: nextRoot,
        newBookRoot: bookRoot,
        newNoteRoot: noteRoot,
        newNullifierRoot: nullifierRoot,
        newSequencingRoot: sequencingRoot
      })
    );
  }
}
