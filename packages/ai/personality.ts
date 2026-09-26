/** Stable semantic boundary; occupations define data, not another decision interface. */
export type ActorInput<Context, State, Stimulus> = {
  actorId: string;
  at: number;
  stimuli: Stimulus[];
  subjectiveState: State;
  knownContext: Context;
};

export type ActorResponse<Attempt, Update, Wake> = {
  attempts: Attempt[];
  subjectiveUpdate?: Update;
  wait: Wake;
};

export interface PersonalityModel<
  Input extends ActorInput<unknown, unknown, unknown>,
  Response extends ActorResponse<unknown, unknown, unknown>,
> {
  decide(input: Input): Response;
}
