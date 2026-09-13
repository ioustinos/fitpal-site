// ─────────────────────────────────────────────────────────────────────────
//  i18n · auth
//  Sign in, sign up, OTP and password recovery.
//
//  WEC-728: extracted verbatim from the old single translations.ts. Values
//  were NOT edited — this split is mechanical on purpose, so that the
//  δεύτερο-ενικό sweep (WEC-675 part A) is the only thing that ever changes
//  wording, and a diff of this commit is provably value-identical.
//
//  Add new strings to the module they belong to, never to a global file:
//  one flat namespace is what pushed every other chat into inline ternaries.
// ─────────────────────────────────────────────────────────────────────────

export const auth = {
  el: {
    // Auth
    signIn: 'Σύνδεση',
    register: 'Εγγραφή',
    email: 'Email',
    password: 'Κωδικός',
    fullName: 'Ονοματεπώνυμο',
    noAccount: 'Δεν έχεις λογαριασμό;',
    haveAccount: 'Έχεις ήδη λογαριασμό;',
  },
  en: {
    // Auth
    signIn: 'Sign In',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    fullName: 'Full Name',
    noAccount: "Don't have an account?",
    haveAccount: 'Already have an account?',
  },
} as const
