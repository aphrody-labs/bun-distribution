import { useCallback, useMemo, useState } from "react";

interface PasswordStrengthFeedback {
  score: number; // 0-100
  level: "very-weak" | "weak" | "fair" | "good" | "strong" | "very-strong";
  suggestions: string[];
  meetsRequirements: {
    minLength: boolean;
    hasUpperCase: boolean;
    hasLowerCase: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
  };
}

interface FormValidation {
  email: boolean;
  password: boolean;
  confirmPassword: boolean;
  passwordsMatch: boolean;
}

/**
 * Hook personnalisé pour la gestion des formulaires d'authentification
 * avec validation en temps réel et force du mot de passe
 */
export function useAuthForm(isSignUp: boolean = false) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  /**
   * Valide une adresse email
   */
  const validateEmail = useCallback((value: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }, []);

  /**
   * Évalue la force du mot de passe
   */
  const evaluatePasswordStrength = useCallback((pwd: string): PasswordStrengthFeedback => {
    const feedback: PasswordStrengthFeedback = {
      level: "very-weak",
      meetsRequirements: {
        hasLowerCase: /[a-z]/.test(pwd),
        hasNumber: /\d/.test(pwd),
        hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd),
        hasUpperCase: /[A-Z]/.test(pwd),
        minLength: pwd.length >= 8,
      },
      score: 0,
      suggestions: [],
    };

    // Calculer le score
    if (feedback.meetsRequirements.minLength) {
      feedback.score += 20;
    }
    if (feedback.meetsRequirements.hasUpperCase) {
      feedback.score += 20;
    }
    if (feedback.meetsRequirements.hasLowerCase) {
      feedback.score += 20;
    }
    if (feedback.meetsRequirements.hasNumber) {
      feedback.score += 20;
    }
    if (feedback.meetsRequirements.hasSpecialChar) {
      feedback.score += 20;
    }

    // Bonus pour les mots de passe longs
    if (pwd.length >= 12) {
      feedback.score = Math.min(100, feedback.score + 10);
    }
    if (pwd.length >= 16) {
      feedback.score = 100;
    }

    // Déterminer le niveau
    if (feedback.score < 20) {
      feedback.level = "very-weak";
    } else if (feedback.score < 40) {
      feedback.level = "weak";
    } else if (feedback.score < 60) {
      feedback.level = "fair";
    } else if (feedback.score < 80) {
      feedback.level = "good";
    } else if (feedback.score < 100) {
      feedback.level = "strong";
    } else {
      feedback.level = "very-strong";
    }

    // Suggestions
    if (!feedback.meetsRequirements.minLength) {
      feedback.suggestions.push("Au moins 8 caractères");
    }
    if (!feedback.meetsRequirements.hasUpperCase) {
      feedback.suggestions.push("Une lettre majuscule");
    }
    if (!feedback.meetsRequirements.hasLowerCase) {
      feedback.suggestions.push("Une lettre minuscule");
    }
    if (!feedback.meetsRequirements.hasNumber) {
      feedback.suggestions.push("Un chiffre");
    }
    if (!feedback.meetsRequirements.hasSpecialChar) {
      feedback.suggestions.push("Un caractère spécial (!@#$% etc.)");
    }

    return feedback;
  }, []);

  /**
   * Valide le formulaire
   */
  const validateForm = useCallback((): FormValidation => {
    const validation: FormValidation = {
      confirmPassword: isSignUp ? confirmPassword.length >= 8 : true,
      email: validateEmail(email),
      password: password.length >= 8,
      passwordsMatch: isSignUp ? password === confirmPassword : true,
    };

    const newErrors: Record<string, string> = {};

    if (!validation.email) {
      newErrors.email = "Adresse email invalide";
    }

    if (!validation.password) {
      newErrors.password = "Le mot de passe doit contenir au moins 8 caractères";
    }

    if (isSignUp) {
      if (!validation.confirmPassword) {
        newErrors.confirmPassword = "Le mot de passe doit contenir au moins 8 caractères";
      }
      if (!validation.passwordsMatch) {
        newErrors.confirmPassword = "Les mots de passe ne correspondent pas";
      }
    }

    setErrors(newErrors);
    return validation;
  }, [email, password, confirmPassword, isSignUp, validateEmail]);

  /**
   * Marquer un champ comme "touché"
   */
  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  /**
   * Réinitialiser le formulaire
   */
  const reset = useCallback(() => {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setTouched({});
    setErrors({});
  }, []);

  const passwordStrength = useMemo(
    () => evaluatePasswordStrength(password),
    [password, evaluatePasswordStrength],
  );

  const isFormValid = useMemo(() => {
    const validation: FormValidation = {
      confirmPassword: isSignUp ? confirmPassword.length >= 8 : true,
      email: validateEmail(email),
      password: password.length >= 8,
      passwordsMatch: isSignUp ? password === confirmPassword : true,
    };
    return (
      validation.email &&
      validation.password &&
      validation.confirmPassword &&
      validation.passwordsMatch
    );
  }, [email, password, confirmPassword, isSignUp, validateEmail]);

  return {
    // Form state
    email,
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    touched,
    errors,

    // Form setters
    setEmail,
    setPassword,
    setConfirmPassword,
    setShowPassword,
    setShowConfirmPassword,

    // Validation
    validateForm,
    validateEmail,
    evaluatePasswordStrength,
    passwordStrength,
    isFormValid,
    handleBlur,
    reset,
  };
}
